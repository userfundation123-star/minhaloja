-- ============================================================
-- supabase.sql — Banco de dados da loja (PostgreSQL / Supabase)
-- ------------------------------------------------------------
-- Como usar: no painel do Supabase, abra "SQL Editor",
-- clique em "New query", cole TODO este arquivo e clique em "Run".
--
-- O que ele cria:
--   1. Tabelas: categorias, produtos, pedidos, itens_pedido
--   2. Regras de segurança (RLS): o público só pode LER produtos
--      e categorias; ninguém pode ler os pedidos pela anon key.
--   3. Função criar_pedido: grava o pedido de forma segura,
--      conferindo preço e estoque no servidor.
--   4. Produtos de exemplo.
--
-- Pode rodar mais de uma vez: os comandos usam "if not exists"
-- / "or replace" / "drop ... if exists" sempre que possível.
-- ============================================================


-- ============================================================
-- 1) TABELAS
-- ============================================================

-- Categorias dos produtos (Eletrônicos, Casa, Moda...)
create table if not exists public.categorias (
  id         bigint generated always as identity primary key,  -- número automático
  nome       text not null unique,
  criado_em  timestamptz not null default now()
);

-- Produtos à venda
create table if not exists public.produtos (
  id            bigint generated always as identity primary key,
  nome          text not null,
  descricao     text,
  preco         numeric(10,2) not null check (preco >= 0),          -- preço atual
  preco_antigo  numeric(10,2) check (preco_antigo >= 0),            -- "de R$ X" (opcional)
  estoque       integer not null default 0 check (estoque >= 0),    -- nunca negativo
  imagem_url    text,
  categoria_id  bigint references public.categorias(id) on delete set null,
  ativo         boolean not null default true,                      -- false = some da loja
  criado_em     timestamptz not null default now()
);

-- Pedidos (cabeçalho: quem comprou e o total)
create table if not exists public.pedidos (
  id                bigint generated always as identity primary key,
  cliente_nome      text not null,
  cliente_email     text not null,
  cliente_telefone  text,
  endereco          text not null,
  total             numeric(10,2) not null default 0,
  status            text not null default 'pendente'
                    check (status in ('pendente','pago','enviado','entregue','cancelado')),
  criado_em         timestamptz not null default now()
);

-- Itens de cada pedido (um pedido tem vários itens)
create table if not exists public.itens_pedido (
  id              bigint generated always as identity primary key,
  pedido_id       bigint not null references public.pedidos(id) on delete cascade,
  produto_id      bigint not null references public.produtos(id),
  quantidade      integer not null check (quantidade > 0),
  preco_unitario  numeric(10,2) not null   -- preço "congelado" no momento da compra
);

-- Índices: deixam as buscas mais rápidas
create index if not exists idx_produtos_categoria on public.produtos(categoria_id);
create index if not exists idx_itens_pedido_pedido on public.itens_pedido(pedido_id);


-- ============================================================
-- 2) SEGURANÇA — ROW LEVEL SECURITY (RLS)
-- ------------------------------------------------------------
-- Com RLS ligado, NADA é permitido até criarmos uma "policy".
-- A anon key (usada no site) entra no banco com o papel "anon".
-- ============================================================
alter table public.categorias   enable row level security;
alter table public.produtos     enable row level security;
alter table public.pedidos      enable row level security;
alter table public.itens_pedido enable row level security;

-- Qualquer visitante pode LER as categorias
drop policy if exists "Categorias são públicas" on public.categorias;
create policy "Categorias são públicas"
  on public.categorias for select
  to anon, authenticated
  using (true);

-- Qualquer visitante pode LER apenas os produtos ativos
drop policy if exists "Produtos ativos são públicos" on public.produtos;
create policy "Produtos ativos são públicos"
  on public.produtos for select
  to anon, authenticated
  using (ativo = true);

-- Pedidos e itens_pedido: NENHUMA policy para anon.
-- Resultado: pela anon key ninguém lê, altera ou apaga pedidos
-- (dados pessoais dos clientes ficam protegidos).
-- Você vê os pedidos pelo painel do Supabase (Table Editor),
-- que usa permissões de administrador.


-- ============================================================
-- 3) FUNÇÃO criar_pedido
-- ------------------------------------------------------------
-- Chamada pelo site com: banco.rpc('criar_pedido', {...})
--
-- "security definer" = a função roda com permissão do dono
-- (administrador), por isso consegue gravar em pedidos mesmo
-- que o anon não possa. Ela é a ÚNICA porta de entrada para
-- criar pedidos, e faz todas as conferências:
--   - produto existe e está ativo
--   - há estoque suficiente
--   - usa o PREÇO DO BANCO (ignora qualquer preço do navegador)
--   - desconta o estoque
-- Se qualquer item falhar, nada é gravado (tudo ou nada).
-- ============================================================
create or replace function public.criar_pedido(
  p_cliente_nome      text,
  p_cliente_email     text,
  p_cliente_telefone  text,
  p_endereco          text,
  p_itens             jsonb    -- ex.: [{"produto_id": 1, "quantidade": 2}, ...]
)
returns bigint                 -- devolve o número do pedido criado
language plpgsql
security definer
set search_path = public       -- evita que alguém "engane" a função com outro schema
as $$
declare
  v_pedido_id  bigint;
  v_item       jsonb;
  v_produto    record;
  v_qtd        integer;
  v_total      numeric(10,2) := 0;
begin
  -- Validações básicas dos dados do cliente
  if coalesce(trim(p_cliente_nome), '') = '' then
    raise exception 'Informe o nome';
  end if;
  if p_cliente_email is null or p_cliente_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail inválido';
  end if;
  if coalesce(trim(p_endereco), '') = '' then
    raise exception 'Informe o endereço';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O carrinho está vazio';
  end if;

  -- Cria o pedido (total começa em 0 e é atualizado no fim)
  insert into pedidos (cliente_nome, cliente_email, cliente_telefone, endereco)
  values (trim(p_cliente_nome), lower(trim(p_cliente_email)), p_cliente_telefone, trim(p_endereco))
  returning id into v_pedido_id;

  -- Percorre cada item enviado pelo site
  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_qtd := (v_item->>'quantidade')::integer;

    if v_qtd is null or v_qtd <= 0 then
      raise exception 'Quantidade inválida';
    end if;

    -- Busca o produto e TRAVA a linha ("for update") para que duas
    -- compras simultâneas não vendam o mesmo último item.
    select id, nome, preco, estoque
      into v_produto
      from produtos
     where id = (v_item->>'produto_id')::bigint
       and ativo = true
     for update;

    if not found then
      raise exception 'Produto % não encontrado', v_item->>'produto_id';
    end if;

    if v_produto.estoque < v_qtd then
      raise exception 'Estoque insuficiente para "%" (disponível: %)', v_produto.nome, v_produto.estoque;
    end if;

    -- Grava o item com o preço REAL do banco
    insert into itens_pedido (pedido_id, produto_id, quantidade, preco_unitario)
    values (v_pedido_id, v_produto.id, v_qtd, v_produto.preco);

    -- Baixa o estoque
    update produtos set estoque = estoque - v_qtd where id = v_produto.id;

    v_total := v_total + v_produto.preco * v_qtd;
  end loop;

  -- Atualiza o total do pedido
  update pedidos set total = v_total where id = v_pedido_id;

  return v_pedido_id;
end;
$$;

-- Permite que o site (anon) e usuários logados chamem a função
revoke all on function public.criar_pedido(text, text, text, text, jsonb) from public;
grant execute on function public.criar_pedido(text, text, text, text, jsonb) to anon, authenticated;


-- ============================================================
-- 4) DADOS DE EXEMPLO
-- ------------------------------------------------------------
-- "on conflict do nothing" evita duplicar categorias se rodar
-- o arquivo de novo. Os produtos só são inseridos se a tabela
-- estiver vazia.
-- ============================================================
insert into public.categorias (nome) values
  ('Eletrônicos'), ('Casa'), ('Moda')
on conflict (nome) do nothing;

insert into public.produtos (nome, descricao, preco, preco_antigo, estoque, imagem_url, categoria_id)
select v.nome, v.descricao, v.preco, v.preco_antigo, v.estoque, v.imagem_url, c.id
from (values
  ('Fone Bluetooth',  'Som limpo e bateria de 30h',          129.90, 199.90, 15, 'https://picsum.photos/seed/fone/400/400',      'Eletrônicos'),
  ('Smartwatch Fit',  'Monitor cardíaco e notificações',     249.90, 349.90,  8, 'https://picsum.photos/seed/relogio/400/400',   'Eletrônicos'),
  ('Caixa de Som',    'Resistente à água, 12h de bateria',   159.90, null,   10, 'https://picsum.photos/seed/caixasom/400/400',  'Eletrônicos'),
  ('Luminária LED',   '3 tons de luz, toque suave',           79.90, null,   20, 'https://picsum.photos/seed/luminaria/400/400', 'Casa'),
  ('Jogo de Cama',    'Algodão 200 fios, casal',             159.90, 219.90,  5, 'https://picsum.photos/seed/cama/400/400',      'Casa'),
  ('Tênis Casual',    'Confortável para o dia a dia',        189.90, 259.90, 12, 'https://picsum.photos/seed/tenis/400/400',     'Moda'),
  ('Mochila Urbana',  'Compartimento para notebook',         139.90, null,    6, 'https://picsum.photos/seed/mochila/400/400',   'Moda')
) as v(nome, descricao, preco, preco_antigo, estoque, imagem_url, categoria)
join public.categorias c on c.nome = v.categoria
where not exists (select 1 from public.produtos);


-- ============================================================
-- CONSULTAS ÚTEIS (rode separadamente quando quiser)
-- ============================================================
-- Ver pedidos com seus itens:
--   select p.id, p.cliente_nome, p.total, p.status, pr.nome, i.quantidade, i.preco_unitario
--   from pedidos p
--   join itens_pedido i on i.pedido_id = p.id
--   join produtos pr on pr.id = i.produto_id
--   order by p.id desc;
--
-- Marcar um pedido como pago:
--   update pedidos set status = 'pago' where id = 1;
