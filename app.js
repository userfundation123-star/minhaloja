/* ============================================================
   app.js — Comportamento da loja
   ------------------------------------------------------------
   O que este arquivo faz:
   1. Conecta ao Supabase usando a URL do projeto e a anon key.
   2. Busca categorias e produtos no banco e mostra na tela.
   3. Controla busca, filtro por categoria e o carrinho.
   4. Envia o pedido para o banco (função criar_pedido no SQL).

   Se o Supabase ainda não estiver configurado, a loja roda em
   "modo demonstração" com produtos de exemplo, para você poder
   testar o visual antes de criar o banco.
   ============================================================ */


/* ============================================================
   1) CONFIGURAÇÃO DO SUPABASE  ← COLE SUAS CHAVES AQUI
   ------------------------------------------------------------
   Onde encontrar: no painel do Supabase, abra seu projeto e vá em
   Project Settings → API (ou "Data API" / "API Keys").

   - SUPABASE_URL: o endereço do projeto (chamado de "Project URL").
   - SUPABASE_ANON_KEY: a chave pública "anon" (também chamada de
     "anon public" ou "publishable key").

   A anon key é PÚBLICA: pode ficar no navegador. Quem protege os
   dados são as regras de segurança (RLS) criadas no arquivo SQL.
   NUNCA coloque aqui a chave "service_role" (ou "secret key"):
   ela ignora todas as regras e dá acesso total ao banco.
   ============================================================ */
const SUPABASE_URL = "https://hjwelqzzghcwzqnnuolh.supabase.co";      // ex.: "https://hjwelqzzghcwzqnnuolh.supabase.co"
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhqd2VscXp6Z2hjd3pxbm51b2xoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5OTY3MjQsImV4cCI6MjEwOTU3MjcyNH0.Y-Vd2kRt0JUv7XhaK-VYu9VyB5rKGkzvto5SBrTLyd4";       // ex.: "eyJhbGciOiJIUzI1NiIs..."


/* ============================================================
   2) CRIAÇÃO DO CLIENTE SUPABASE
   ------------------------------------------------------------
   "window.supabase" vem do script do CDN carregado no index.html.
   Só criamos o cliente se as chaves foram preenchidas.
   ============================================================ */
const configurado =
  SUPABASE_URL.startsWith("http") && !SUPABASE_ANON_KEY.startsWith("COLE_AQUI");

const banco = configurado
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null; // null = modo demonstração


/* ============================================================
   3) DADOS DE DEMONSTRAÇÃO
   Usados apenas quando o banco não está configurado ou dá erro.
   Têm o mesmo formato que as tabelas do Supabase.
   ============================================================ */
const CATEGORIAS_DEMO = [
  { id: 1, nome: "Eletrônicos" },
  { id: 2, nome: "Casa" },
  { id: 3, nome: "Moda" },
];

const PRODUTOS_DEMO = [
  { id: 1, nome: "Fone Bluetooth", descricao: "Som limpo e bateria de 30h", preco: 129.9, preco_antigo: 199.9, estoque: 15, categoria_id: 1, imagem_url: "https://picsum.photos/seed/fone/400/400" },
  { id: 2, nome: "Smartwatch Fit", descricao: "Monitor cardíaco e notificações", preco: 249.9, preco_antigo: 349.9, estoque: 8, categoria_id: 1, imagem_url: "https://picsum.photos/seed/relogio/400/400" },
  { id: 3, nome: "Luminária LED", descricao: "3 tons de luz, toque suave", preco: 79.9, preco_antigo: null, estoque: 20, categoria_id: 2, imagem_url: "https://picsum.photos/seed/luminaria/400/400" },
  { id: 4, nome: "Jogo de Cama", descricao: "Algodão 200 fios, casal", preco: 159.9, preco_antigo: 219.9, estoque: 0, categoria_id: 2, imagem_url: "https://picsum.photos/seed/cama/400/400" },
  { id: 5, nome: "Tênis Casual", descricao: "Confortável para o dia a dia", preco: 189.9, preco_antigo: 259.9, estoque: 12, categoria_id: 3, imagem_url: "https://picsum.photos/seed/tenis/400/400" },
  { id: 6, nome: "Mochila Urbana", descricao: "Compartimento para notebook", preco: 139.9, preco_antigo: null, estoque: 6, categoria_id: 3, imagem_url: "https://picsum.photos/seed/mochila/400/400" },
];


/* ============================================================
   4) ESTADO DA APLICAÇÃO
   Variáveis que guardam a "situação atual" da loja.
   ============================================================ */
let produtos = [];          // Todos os produtos carregados
let categorias = [];        // Todas as categorias carregadas
let categoriaAtual = null;  // null = "Todas"
let textoBusca = "";        // O que foi digitado na busca

// O carrinho é salvo no localStorage do navegador para não se perder
// ao recarregar a página. Formato: [{ id, nome, preco, imagem_url, quantidade }]
let carrinho = lerCarrinhoSalvo();


/* ============================================================
   5) ATALHOS PARA ELEMENTOS DO HTML
   Pegamos uma vez só e reutilizamos (é mais rápido).
   ============================================================ */
const el = {
  grade: document.getElementById("grade-produtos"),
  carregando: document.getElementById("carregando"),
  categorias: document.getElementById("lista-categorias"),
  busca: document.getElementById("campo-busca"),
  botaoBusca: document.getElementById("botao-busca"),
  alerta: document.getElementById("alerta-conexao"),
  contador: document.getElementById("contador-carrinho"),
  carrinho: document.getElementById("carrinho"),
  fundo: document.getElementById("fundo-escuro"),
  itensCarrinho: document.getElementById("itens-carrinho"),
  totalCarrinho: document.getElementById("total-carrinho"),
  abrirCarrinho: document.getElementById("abrir-carrinho"),
  fecharCarrinho: document.getElementById("fechar-carrinho"),
  irCheckout: document.getElementById("ir-checkout"),
  modal: document.getElementById("modal-checkout"),
  fecharCheckout: document.getElementById("fechar-checkout"),
  formCheckout: document.getElementById("form-checkout"),
  totalCheckout: document.getElementById("total-checkout"),
  confirmar: document.getElementById("confirmar-pedido"),
  toast: document.getElementById("toast"),
};


/* ============================================================
   6) FUNÇÕES AUXILIARES
   ============================================================ */

// Formata número como dinheiro brasileiro: 129.9 → "R$ 129,90"
function formatarPreco(valor) {
  return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Protege contra código malicioso: se um nome de produto tiver "<script>",
// ele aparece como texto em vez de ser executado.
function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

// Mostra um aviso rápido no rodapé da tela por 3 segundos.
// tipo pode ser "", "sucesso" ou "erro" (muda a cor no CSS).
let tempoToast;
function mostrarToast(mensagem, tipo = "") {
  el.toast.textContent = mensagem;
  el.toast.className = `toast mostrar ${tipo}`;
  clearTimeout(tempoToast);
  tempoToast = setTimeout(() => (el.toast.className = "toast"), 3000);
}

// Remove acentos e deixa minúsculo, para a busca achar
// "eletronico" mesmo que o nome seja "Eletrônico".
function normalizar(texto) {
  return (texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}


/* ============================================================
   7) CARREGAR DADOS DO SUPABASE
   ============================================================ */
async function carregarDados() {
  // Sem chaves → modo demonstração
  if (!banco) {
    el.alerta.hidden = false;
    el.alerta.innerHTML =
      "⚠️ <strong>Modo demonstração:</strong> preencha <code>SUPABASE_URL</code> e " +
      "<code>SUPABASE_ANON_KEY</code> no arquivo <code>app.js</code> para conectar ao banco.";
    categorias = CATEGORIAS_DEMO;
    produtos = PRODUTOS_DEMO;
    return;
  }

  try {
    // Busca as duas tabelas AO MESMO TEMPO (Promise.all), o que é mais rápido.
    const [respCategorias, respProdutos] = await Promise.all([
      // SELECT id, nome FROM categorias ORDER BY nome
      banco.from("categorias").select("id, nome").order("nome"),

      // SELECT ... FROM produtos WHERE ativo = true ORDER BY criado_em DESC
      banco
        .from("produtos")
        .select("id, nome, descricao, preco, preco_antigo, estoque, imagem_url, categoria_id")
        .eq("ativo", true)
        .order("criado_em", { ascending: false }),
    ]);

    // O Supabase não "lança" erro: ele devolve um objeto { data, error }.
    if (respCategorias.error) throw respCategorias.error;
    if (respProdutos.error) throw respProdutos.error;

    categorias = respCategorias.data;
    produtos = respProdutos.data;
  } catch (erro) {
    console.error("Erro ao buscar dados no Supabase:", erro);
    el.alerta.hidden = false;
    el.alerta.innerHTML =
      "⚠️ Não foi possível ler o banco (" + escaparHTML(erro.message) + "). " +
      "Mostrando produtos de exemplo. Confira as chaves e se o SQL foi executado.";
    categorias = CATEGORIAS_DEMO;
    produtos = PRODUTOS_DEMO;
  }
}


/* ============================================================
   8) DESENHAR NA TELA (renderização)
   ============================================================ */

// Cria os botões de categoria
function renderizarCategorias() {
  // Botão "Todas" + um botão por categoria
  const botoes = [{ id: null, nome: "Todas" }, ...categorias]
    .map(
      (c) => `<button class="categoria ${c.id === categoriaAtual ? "ativa" : ""}"
                      data-id="${c.id ?? ""}">${escaparHTML(c.nome)}</button>`
    )
    .join("");
  el.categorias.innerHTML = botoes;
}

// Cria os cartões de produto, aplicando filtro de categoria e busca
function renderizarProdutos() {
  el.carregando.hidden = true;

  const busca = normalizar(textoBusca);

  const filtrados = produtos.filter((p) => {
    const passaCategoria = categoriaAtual === null || p.categoria_id === categoriaAtual;
    const passaBusca =
      !busca || normalizar(p.nome).includes(busca) || normalizar(p.descricao).includes(busca);
    return passaCategoria && passaBusca;
  });

  if (filtrados.length === 0) {
    el.grade.innerHTML = `<p class="vazio">Nenhum produto encontrado 😕</p>`;
    return;
  }

  el.grade.innerHTML = filtrados
    .map((p) => {
      // Calcula a porcentagem de desconto, se houver preço antigo maior
      const temDesconto = p.preco_antigo && Number(p.preco_antigo) > Number(p.preco);
      const desconto = temDesconto
        ? Math.round((1 - p.preco / p.preco_antigo) * 100)
        : 0;
      const esgotado = p.estoque <= 0;
      const parcela = formatarPreco(p.preco / 10);

      return `
        <article class="produto">
          ${temDesconto ? `<span class="produto__desconto">-${desconto}%</span>` : ""}
          <img class="produto__imagem" src="${escaparHTML(p.imagem_url || "https://picsum.photos/400")}"
               alt="${escaparHTML(p.nome)}" loading="lazy" />
          <div class="produto__info">
            <h3 class="produto__nome">${escaparHTML(p.nome)}</h3>
            <p class="produto__descricao">${escaparHTML(p.descricao)}</p>
            ${temDesconto ? `<span class="produto__preco-antigo">${formatarPreco(p.preco_antigo)}</span>` : ""}
            <span class="produto__preco">${formatarPreco(p.preco)}</span>
            <span class="produto__parcelas">ou 10x de ${parcela} sem juros</span>
            ${
              esgotado
                ? `<span class="produto__esgotado">Esgotado</span>`
                : `<button class="botao botao--destaque botao--largo" data-adicionar="${p.id}">
                     Adicionar ao carrinho
                   </button>`
            }
          </div>
        </article>`;
    })
    .join("");
}

// Desenha a lista do carrinho, o total e o contador do cabeçalho
function renderizarCarrinho() {
  const totalItens = carrinho.reduce((soma, item) => soma + item.quantidade, 0);
  const totalValor = calcularTotal();

  el.contador.textContent = totalItens;
  el.totalCarrinho.textContent = formatarPreco(totalValor);
  el.totalCheckout.textContent = formatarPreco(totalValor);
  el.irCheckout.disabled = carrinho.length === 0;

  if (carrinho.length === 0) {
    el.itensCarrinho.innerHTML = `<li class="vazio">Seu carrinho está vazio.</li>`;
    return;
  }

  el.itensCarrinho.innerHTML = carrinho
    .map(
      (item) => `
      <li class="item-carrinho">
        <img src="${escaparHTML(item.imagem_url)}" alt="" />
        <div>
          <div class="item-carrinho__nome">${escaparHTML(item.nome)}</div>
          <div class="item-carrinho__preco">${formatarPreco(item.preco * item.quantidade)}</div>
          <div class="quantidade">
            <button data-menos="${item.id}" aria-label="Diminuir">−</button>
            <span>${item.quantidade}</span>
            <button data-mais="${item.id}" aria-label="Aumentar">+</button>
          </div>
        </div>
        <button class="remover" data-remover="${item.id}" aria-label="Remover">🗑</button>
      </li>`
    )
    .join("");
}


/* ============================================================
   9) LÓGICA DO CARRINHO
   ============================================================ */

function lerCarrinhoSalvo() {
  try {
    return JSON.parse(localStorage.getItem("carrinho")) || [];
  } catch {
    return []; // Se o navegador bloquear o localStorage, começa vazio
  }
}

function salvarCarrinho() {
  try {
    localStorage.setItem("carrinho", JSON.stringify(carrinho));
  } catch {
    /* Ignora: o carrinho continua funcionando só na memória */
  }
  renderizarCarrinho();
}

function calcularTotal() {
  return carrinho.reduce((soma, item) => soma + item.preco * item.quantidade, 0);
}

function adicionarAoCarrinho(idProduto) {
  const produto = produtos.find((p) => p.id === idProduto);
  if (!produto) return;

  const item = carrinho.find((i) => i.id === idProduto);
  const qtdAtual = item ? item.quantidade : 0;

  // Não deixa colocar mais do que tem em estoque
  if (qtdAtual + 1 > produto.estoque) {
    mostrarToast("Quantidade máxima em estoque atingida", "erro");
    return;
  }

  if (item) {
    item.quantidade++;
  } else {
    carrinho.push({
      id: produto.id,
      nome: produto.nome,
      preco: Number(produto.preco),
      imagem_url: produto.imagem_url,
      quantidade: 1,
    });
  }
  salvarCarrinho();
  mostrarToast(`"${produto.nome}" adicionado ao carrinho`, "sucesso");
}

function alterarQuantidade(idProduto, mudanca) {
  const item = carrinho.find((i) => i.id === idProduto);
  if (!item) return;

  const produto = produtos.find((p) => p.id === idProduto);
  const novaQtd = item.quantidade + mudanca;

  if (produto && novaQtd > produto.estoque) {
    mostrarToast("Sem mais unidades em estoque", "erro");
    return;
  }
  if (novaQtd <= 0) {
    removerDoCarrinho(idProduto);
    return;
  }
  item.quantidade = novaQtd;
  salvarCarrinho();
}

function removerDoCarrinho(idProduto) {
  carrinho = carrinho.filter((i) => i.id !== idProduto);
  salvarCarrinho();
}

function abrirCarrinho() {
  el.carrinho.classList.add("aberto");
  el.fundo.classList.add("visivel");
}
function fecharCarrinho() {
  el.carrinho.classList.remove("aberto");
  el.fundo.classList.remove("visivel");
}


/* ============================================================
   10) FINALIZAR PEDIDO (CHECKOUT)
   ------------------------------------------------------------
   O pedido é enviado chamando a função "criar_pedido" do banco
   (via .rpc). Ela é mais segura do que gravar direto na tabela,
   porque o PREÇO e o ESTOQUE são conferidos no servidor: mesmo
   que alguém altere o preço no navegador, o banco usa o preço real.
   ============================================================ */
async function enviarPedido(evento) {
  evento.preventDefault(); // Impede o formulário de recarregar a página

  if (carrinho.length === 0) return;

  // Lê os campos do formulário
  const dados = new FormData(el.formCheckout);

  // Só mandamos o ID e a QUANTIDADE de cada item. O preço o banco busca.
  const itens = carrinho.map((i) => ({ produto_id: i.id, quantidade: i.quantidade }));

  el.confirmar.disabled = true;
  el.confirmar.textContent = "Enviando...";

  try {
    if (!banco) {
      // Modo demonstração: só simula um pedido
      await new Promise((r) => setTimeout(r, 800));
      mostrarToast("Pedido simulado! Configure o Supabase para gravar de verdade.", "sucesso");
    } else {
      const { data: idPedido, error } = await banco.rpc("criar_pedido", {
        p_cliente_nome: dados.get("nome"),
        p_cliente_email: dados.get("email"),
        p_cliente_telefone: dados.get("telefone"),
        p_endereco: dados.get("endereco"),
        p_itens: itens,
      });
      if (error) throw error;

      mostrarToast(`Pedido nº ${idPedido} realizado com sucesso! 🎉`, "sucesso");

      // Recarrega os produtos para mostrar o estoque atualizado
      await carregarDados();
      renderizarProdutos();
    }

    // Limpa tudo após o sucesso
    carrinho = [];
    salvarCarrinho();
    el.formCheckout.reset();
    el.modal.hidden = true;
    fecharCarrinho();
  } catch (erro) {
    console.error("Erro ao criar pedido:", erro);
    mostrarToast("Não foi possível concluir: " + erro.message, "erro");
  } finally {
    el.confirmar.disabled = false;
    el.confirmar.textContent = "Confirmar pedido";
  }
}


/* ============================================================
   11) EVENTOS (o que acontece quando o usuário clica/digita)
   ------------------------------------------------------------
   Usamos "delegação de eventos": em vez de pôr um ouvinte em
   cada botão, colocamos um só no "pai" e verificamos qual botão
   foi clicado pelo atributo data-*. Isso funciona mesmo para
   botões criados depois pelo JS.
   ============================================================ */

// Clique nas categorias
el.categorias.addEventListener("click", (e) => {
  const botao = e.target.closest(".categoria");
  if (!botao) return;
  categoriaAtual = botao.dataset.id ? Number(botao.dataset.id) : null;
  renderizarCategorias();
  renderizarProdutos();
});

// Busca enquanto digita
el.busca.addEventListener("input", () => {
  textoBusca = el.busca.value;
  renderizarProdutos();
});
el.botaoBusca.addEventListener("click", () => {
  document.getElementById("produtos").scrollIntoView({ behavior: "smooth" });
});

// Botão "Adicionar ao carrinho" nos cartões
el.grade.addEventListener("click", (e) => {
  const botao = e.target.closest("[data-adicionar]");
  if (botao) adicionarAoCarrinho(Number(botao.dataset.adicionar));
});

// Botões + / − / remover dentro do carrinho
el.itensCarrinho.addEventListener("click", (e) => {
  const mais = e.target.closest("[data-mais]");
  const menos = e.target.closest("[data-menos]");
  const remover = e.target.closest("[data-remover]");
  if (mais) alterarQuantidade(Number(mais.dataset.mais), +1);
  if (menos) alterarQuantidade(Number(menos.dataset.menos), -1);
  if (remover) removerDoCarrinho(Number(remover.dataset.remover));
});

// Abrir e fechar carrinho
el.abrirCarrinho.addEventListener("click", abrirCarrinho);
el.fecharCarrinho.addEventListener("click", fecharCarrinho);
el.fundo.addEventListener("click", fecharCarrinho);

// Abrir e fechar checkout
el.irCheckout.addEventListener("click", () => {
  if (carrinho.length) el.modal.hidden = false;
});
el.fecharCheckout.addEventListener("click", () => (el.modal.hidden = true));
el.modal.addEventListener("click", (e) => {
  if (e.target === el.modal) el.modal.hidden = true; // clique fora da caixa fecha
});

// Envio do formulário
el.formCheckout.addEventListener("submit", enviarPedido);

// Tecla ESC fecha carrinho e modal
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    fecharCarrinho();
    el.modal.hidden = true;
  }
});


/* ============================================================
   12) INÍCIO — roda assim que a página abre
   ============================================================ */
async function iniciar() {
  document.getElementById("ano").textContent = new Date().getFullYear();
  renderizarCarrinho();        // Mostra o carrinho salvo
  await carregarDados();       // Busca dados no Supabase (ou demo)
  renderizarCategorias();
  renderizarProdutos();
}

iniciar();
