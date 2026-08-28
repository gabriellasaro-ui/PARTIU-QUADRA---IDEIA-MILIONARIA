/* Cadastro da arena — o percurso de oito passos.

   O QUE ESTE ARQUIVO GARANTE:

   1. CADA PASSO GRAVA NO SERVIDOR antes de avancar. O dono responde isso do
      celular, no intervalo do trabalho; se fechar o app custar recomecar, o
      cadastro simplesmente nao acontece. Nada fica so em memoria.

   2. AO ABRIR, a pagina PERGUNTA a ficha e vai para onde parou. Se ja ha
      sessao de gerente, nem mostra o passo 1 de novo.

   3. O erro do servidor aparece INTEIRO. As mensagens do backend foram
      escritas para serem lidas por quem cadastra ("Ainda falta preencher: o
      CNPJ, o CEP") — trocar por "erro ao salvar" jogaria fora a parte util.

   Reaproveita o que ja existe e ja foi depurado em services/: `venueService`
   para CEP e cidades, `localidades` para o par UF -> cidade. Nao importa
   `manager-forms.js`: aquele modulo carrega quadras, reservas e o painel
   inteiro junto, e aqui nao ha painel nenhum. */
import api from '../../services/api.js';
import authService from '../../services/auth.js';
import storage from '../../storage/storage.js';
import venueService from '../../services/venues.js';
import { montarEstados, pintarCidades } from '../../services/localidades.js';
import { ARENA_FEE_RATE } from '../../config/constants.js';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

const PASSO_FIM = 9;
const PASSO_RECUSADA = 0;

const ESPORTES = [
  ['society', 'Society'], ['futsal', 'Futsal'], ['campo', 'Campo'],
  ['areia', 'Futevôlei / Areia'], ['volei', 'Vôlei'],
  ['basquete', 'Basquete'], ['tenis', 'Tênis'], ['beach_tennis', 'Beach tennis'],
];

/* As dores sao o campo que diz se o Qadras resolve o problema DELE — e nao so
   se a quadra existe. Escritas na voz de quem tem quadra, nao em categoria de
   CRM: "horário vago" e o que ele fala, "baixa taxa de ocupação" nao. */
const DORES = [
  ['horarios_vagos', 'Tenho muito horário vago'],
  ['sem_previsao', 'Não sei quem vem'],
  ['calote', 'Levo calote / desmarcam em cima'],
  ['caderno', 'Controlo tudo no caderno ou no WhatsApp'],
  ['divulgacao', 'Pouca gente conhece minha quadra'],
  ['cobranca', 'Perco tempo cobrando'],
];

const estado = { passo: 1, esportes: [], dores: [], fotos: [] };

// ── Utilidades de tela ─────────────────────────────────────────────────────

function mostrar(passo) {
  estado.passo = passo;
  $$('[data-passo]').forEach((s) => { s.hidden = Number(s.dataset.passo) !== passo; });

  const contador = $('.cad-passo-num');
  const barra = $('[data-barra]');
  const util = passo >= 1 && passo <= 8;
  if (contador) contador.hidden = !util;
  if (barra) barra.style.width = (util ? (passo / 8) * 100 : 100) + '%';
  const atual = $('[data-passo-atual]');
  if (atual && util) atual.textContent = String(passo);
  $('.cad-progresso')?.setAttribute('aria-valuenow', String(util ? passo : 8));

  limparErro();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  // Foco no primeiro campo: no celular abre o teclado direto e poupa um toque.
  const primeiro = $(`[data-passo="${passo}"] input, [data-passo="${passo}"] select`);
  if (primeiro && window.matchMedia('(min-width: 700px)').matches) primeiro.focus();
}

function erro(msg) {
  const el = $('[data-erro]');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
  if (msg) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
const limparErro = () => erro('');

/* Mensagem do servidor por inteiro. Ela foi escrita para quem cadastra ler —
   "Ainda falta preencher: o CNPJ, o CEP" resolve; "erro ao salvar" nao. */
function mensagemDe(falha) {
  return falha?.message || 'Não foi possível continuar. Tente de novo.';
}

async function comBotao(botao, tarefa) {
  if (!botao) return tarefa();
  const texto = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'Aguarde…';
  try {
    return await tarefa();
  } finally {
    botao.disabled = false;
    botao.textContent = texto;
  }
}

// ── Ficha ──────────────────────────────────────────────────────────────────

function preencher(ficha) {
  const por = (sel, valor) => { const el = $(sel); if (el && valor != null) el.value = valor; };
  por('#c-arena', ficha.arenaNome);
  por('#c-cnpj', ficha.cnpj);
  por('#c-razao', ficha.razaoSocial);
  por('#c-cep', ficha.cep);
  por('#c-rua', ficha.endereco);
  por('#c-numero', ficha.numero);
  por('#c-compl', ficha.complemento);
  por('#c-bairro', ficha.bairro);
  por('#c-resp', ficha.contatoNome);
  por('#c-tel', ficha.contatoTelefone);
  por('#c-quantas', ficha.quantasQuadras);
  por('#c-fat', ficha.faturamento);

  estado.esportes = ficha.esportes || [];
  estado.dores = ficha.dores || [];
  estado.fotos = ficha.fotos || [];
  pintarEscolhas();
  pintarFotos();

  const destino = $('[data-email-destino]');
  if (destino) destino.textContent = ficha.contatoEmail || '';
  const fimArena = $('[data-fim-arena]');
  if (fimArena && ficha.arenaNome) fimArena.textContent = ficha.arenaNome;
  const fimEmail = $('[data-fim-email]');
  if (fimEmail) fimEmail.textContent = ficha.contatoEmail || '';

  if (ficha.estado) {
    montarEstados($('[data-uf]'), ficha.estado)
      .then(() => pintarCidades($('[data-cidade]'), ficha.estado, ficha.cidade));
  }
}

function passoDe(ficha) {
  if (ficha.status === 'recusada') return PASSO_RECUSADA;
  if (ficha.status === 'enviada' || ficha.status === 'em_analise' || ficha.status === 'aprovada') {
    return PASSO_FIM;
  }
  // E-mail nao confirmado prende no passo 2, mesmo que a ficha esteja adiante:
  // sem ele o envio falharia la no fim, depois de sete telas preenchidas.
  if (ficha.emailVerificado === false) return 2;
  return Math.min(Math.max(ficha.passo || 2, 2), 8);
}

async function retomar() {
  if (!authService.hasSession()) return false;
  try {
    const ficha = await api.get('/api/arenas/solicitacao/minha');
    preencher(ficha);
    if (ficha.motivoRecusa) {
      const el = $('[data-motivo]');
      if (el) el.textContent = ficha.motivoRecusa;
    }
    mostrar(passoDe(ficha));
    return true;
  } catch (falha) {
    /* Sessao de gerente SEM ficha e o dono que ja tem arena: o lugar dele e o
       painel, nao este formulario. Sem este desvio ele veria "Cadastro nao
       encontrado" numa tela que nao explica nada. */
    if (falha?.status === 404 && authService.currentUser()?.role === 'gerente') {
      location.replace('./dashboard.html');
      return true;
    }
    storage.clearSession();
    return false;
  }
}

// ── Escolhas ───────────────────────────────────────────────────────────────

function pintarEscolhas() {
  const desenhar = (raiz, lista, selecionados) => {
    if (!raiz) return;
    raiz.innerHTML = lista.map(([valor, rotulo]) => `
      <button type="button" class="cad-escolha" data-valor="${valor}"
              aria-pressed="${selecionados.includes(valor)}">${rotulo}</button>`).join('');
  };
  desenhar($('[data-esportes]'), ESPORTES, estado.esportes);
  desenhar($('[data-dores]'), DORES, estado.dores);
}

function ligarEscolhas() {
  const ligar = (sel, alvo) => {
    $(sel)?.addEventListener('click', (ev) => {
      const botao = ev.target.closest('.cad-escolha');
      if (!botao) return;
      const valor = botao.dataset.valor;
      const i = estado[alvo].indexOf(valor);
      if (i >= 0) estado[alvo].splice(i, 1);
      else estado[alvo].push(valor);
      botao.setAttribute('aria-pressed', String(i < 0));
    });
  };
  ligar('[data-esportes]', 'esportes');
  ligar('[data-dores]', 'dores');
}

// ── Fotos ──────────────────────────────────────────────────────────────────

const MAX_FOTOS = 6;
/* Duas, e nao uma: a tela pede fachada E quadra pelo nome, e com uma so fica
   ambiguo qual foi enviada. CNPJ e endereco nao provam que existe uma quadra
   ali — os dois cabem num lote vazio. A foto e o unico material que prova, e e
   gratuita para quem de fato tem a quadra. */
const MIN_FOTOS = 2;

function pintarFotos() {
  const raiz = $('[data-fotos]');
  if (!raiz) return;
  const cartoes = estado.fotos.map((src, i) => `
    <div class="cad-foto">
      <img src="${src}" alt="">
      <button type="button" data-remove="${i}" aria-label="Remover foto">×</button>
    </div>`).join('');
  const add = estado.fotos.length < MAX_FOTOS
    ? '<button type="button" class="cad-foto-add" data-add>+</button>' : '';
  raiz.innerHTML = cartoes + add;

  /* Diz quantas FALTAM, e nao "envie fotos". O botao continua clicavel: barrar
     antes de tentar esconde o motivo, e a pessoa fica olhando para um botao
     apagado sem saber o que ele quer. */
  const falta = $('[data-fotos-falta]');
  if (falta) {
    const faltam = MIN_FOTOS - estado.fotos.length;
    falta.hidden = faltam <= 0;
    falta.textContent = faltam === MIN_FOTOS
      ? 'Envie 2 fotos para continuar: a fachada e a quadra.'
      : `Falta ${faltam} foto.`;
  }
}

/* Reduz ANTES de mandar. Foto de celular tem 4 MB; seis delas viram 24 MB de
   base64 num PATCH, o que estoura limite de corpo e trava o cadastro no 4G.
   1280px de largura e o suficiente para o cartao da quadra no app. */
function reduzir(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error('Não consegui ler a imagem'));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Arquivo de imagem inválido'));
      img.onload = () => {
        const escala = Math.min(1, 1280 / img.width);
        const tela = document.createElement('canvas');
        tela.width = Math.round(img.width * escala);
        tela.height = Math.round(img.height * escala);
        tela.getContext('2d').drawImage(img, 0, 0, tela.width, tela.height);
        resolve(tela.toDataURL('image/jpeg', 0.82));
      };
      img.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  });
}

function ligarFotos() {
  const entrada = $('[data-arquivo]');
  $('[data-fotos]')?.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-add]')) { entrada?.click(); return; }
    const remover = ev.target.closest('[data-remove]');
    if (remover) {
      estado.fotos.splice(Number(remover.dataset.remove), 1);
      pintarFotos();
    }
  });
  entrada?.addEventListener('change', async () => {
    const arquivos = Array.from(entrada.files || []).slice(0, MAX_FOTOS - estado.fotos.length);
    for (const arquivo of arquivos) {
      try {
        estado.fotos.push(await reduzir(arquivo));
      } catch (falha) {
        erro(falha.message);
      }
    }
    entrada.value = '';
    pintarFotos();
  });
}

// ── CEP ────────────────────────────────────────────────────────────────────

/* Mesmo comportamento ja resolvido no painel: preenche o que der e deixa tudo
   editavel. Servico de terceiro fora do ar avisa e sai de cena — travar o
   cadastro porque o ViaCEP caiu seria trocar um problema pequeno por um
   grande. */
async function buscarCep() {
  const campo = $('[data-cep]');
  const aviso = $('[data-cep-aviso]');
  const diz = (texto, ruim) => {
    if (!aviso) return;
    aviso.hidden = !texto;
    aviso.textContent = texto || '';
    aviso.classList.toggle('is-erro', Boolean(ruim));
  };

  const limpo = (campo?.value || '').replace(/\D/g, '');
  if (limpo.length !== 8) { diz('Digite os 8 números do CEP.', true); return; }

  diz('Buscando…', false);
  let dados;
  try {
    dados = await venueService.enderecoPorCep(limpo);
  } catch (falha) {
    diz(falha?.status === 404
      ? 'CEP não encontrado. Confira o número ou preencha à mão.'
      : 'Não deu para consultar agora — preencha à mão.', true);
    return;
  }
  if (!dados) { diz('', false); return; }

  const por = (sel, valor) => { const el = $(sel); if (el && valor) el.value = valor; };
  por('#c-rua', dados.logradouro);
  por('#c-bairro', dados.bairro);
  diz('', false);

  /* UF e cidade sao selects ENCADEADOS: escrever a cidade sem repovoar a lista
     da UF nova faz o valor cair fora. Monta na ordem certa. */
  if (dados.estado) {
    await montarEstados($('[data-uf]'), dados.estado);
    await pintarCidades($('[data-cidade]'), dados.estado, dados.cidade);
  }
  $('#c-numero')?.focus();
}

// ── CNPJ ───────────────────────────────────────────────────────────────────

async function consultarCnpj() {
  const campo = $('#c-cnpj');
  const aviso = $('[data-cnpj-aviso]');
  const limpo = (campo?.value || '').replace(/\D/g, '');
  if (limpo.length !== 14 || !aviso) return;

  aviso.hidden = false;
  aviso.className = 'cad-aviso';
  aviso.textContent = 'Consultando…';
  try {
    const info = await api.get(`/api/arenas/cnpj/${limpo}`, { auth: false });
    const razao = $('#c-razao');
    if (razao && !razao.value && info.razaoSocial) razao.value = info.razaoSocial;
    /* `classList.toggle(nome, cond)` e nao `add(cond ? nome : '')`: string
       VAZIA em classList.add lanca DOMException. E o sucesso, que jogava a
       excecao no catch abaixo e mostrava "nao consegui consultar" — com o
       servidor tendo respondido 200 em 1,5ms. */
    aviso.classList.toggle('is-bom', Boolean(info.cnaeEsportivo));
    aviso.textContent = info.cnaeEsportivo
      ? `${info.razaoSocial} · atividade esportiva confirmada`
      : `${info.razaoSocial} · ${info.situacao}`;
  } catch (falha) {
    /* Nao e erro do dono: pode ser CNPJ novo ou o servico fora do ar. O campo
       segue editavel, que e o que importa. */
    aviso.textContent = 'Não consegui consultar agora — pode seguir e preencher à mão.';
  }
}

// ── Acoes ──────────────────────────────────────────────────────────────────

async function criarConta(botao) {
  const nome = $('#c-nome').value.trim();
  const email = $('#c-email').value.trim();
  const senha = $('#c-senha').value;
  if (!nome || !email || !senha) { erro('Preencha nome, e-mail e senha.'); return; }

  await comBotao(botao, async () => {
    try {
      const sessao = await api.post('/api/arenas/solicitacao', { nome, email, senha }, { auth: false });
      if (sessao?.token) storage.setAuthToken(sessao.token);
      if (sessao?.refreshToken) storage.setAuthRefreshToken(sessao.refreshToken);
      if (sessao?.user) storage.setAuthUser(sessao.user);
      preencher(sessao.ficha || {});
      $('[data-email-destino]').textContent = email;
      await pedirCodigo();
      mostrar(2);
    } catch (falha) {
      erro(mensagemDe(falha));
    }
  });
}

async function pedirCodigo() {
  try {
    const r = await api.post('/api/auth/verificar/enviar', {});
    // Fora de producao o servidor devolve o codigo; mostrar poupa abrir o log.
    const caixa = $('[data-codigo-dev]');
    if (caixa && r?.codigo) {
      caixa.hidden = false;
      caixa.textContent = `modo de teste — seu código é ${r.codigo}`;
    }
    return true;
  } catch (falha) {
    erro(mensagemDe(falha));
    return false;
  }
}

async function conferirCodigo(botao) {
  const codigo = ($('#c-codigo').value || '').replace(/\D/g, '');
  if (codigo.length !== 6) { erro('Digite os 6 números do código.'); return; }
  await comBotao(botao, async () => {
    try {
      await api.post('/api/auth/verificar/conferir', { codigo });
      mostrar(3);
    } catch (falha) {
      erro(mensagemDe(falha));
    }
  });
}

function dadosDoPasso(n) {
  const v = (sel) => ($(sel)?.value || '').trim();
  if (n === 3) return { arena_name: v('#c-arena'), cnpj: v('#c-cnpj'), legal_name: v('#c-razao') };
  if (n === 4) {
    return {
      cep: v('#c-cep').replace(/\D/g, ''), address: v('#c-rua'), number: v('#c-numero'),
      complement: v('#c-compl'), neighborhood: v('#c-bairro'),
      city: v('[data-cidade]'), state: v('[data-uf]'),
    };
  }
  if (n === 5) return { contact_name: v('#c-resp'), contact_phone: v('#c-tel') };
  if (n === 6) {
    return {
      court_count: Number(v('#c-quantas')) || 1,
      sports: estado.esportes, pains: estado.dores, revenue_range: v('#c-fat'),
    };
  }
  if (n === 7) return { photos: estado.fotos };
  return {};
}

async function gravarPasso(n, botao) {
  if (n === 7 && estado.fotos.length < MIN_FOTOS) {
    erro(`Envie ${MIN_FOTOS} fotos — a fachada e a quadra — para continuar.`);
    return;
  }
  await comBotao(botao, async () => {
    try {
      await api.patch(`/api/arenas/solicitacao/passo/${n}`, dadosDoPasso(n));
      mostrar(n + 1);
    } catch (falha) {
      erro(mensagemDe(falha));
    }
  });
}

async function enviar(botao) {
  const taxa = $('[data-aceite-taxa]').checked;
  const termos = $('[data-aceite-termos]').checked;
  if (!taxa || !termos) { erro('Marque os dois aceites para enviar.'); return; }

  await comBotao(botao, async () => {
    try {
      await api.post('/api/arenas/solicitacao/aceites', { taxa, termos });
      const ficha = await api.post('/api/arenas/solicitacao/enviar', {});
      const fimArena = $('[data-fim-arena]');
      if (fimArena && ficha.arenaNome) fimArena.textContent = ficha.arenaNome;
      const fimEmail = $('[data-fim-email]');
      if (fimEmail) fimEmail.textContent = ficha.contatoEmail || '';
      mostrar(PASSO_FIM);
    } catch (falha) {
      erro(mensagemDe(falha));
    }
  });
}

// ── Ligacao ────────────────────────────────────────────────────────────────

document.addEventListener('click', (ev) => {
  const botao = ev.target.closest('[data-acao]');
  if (!botao) return;
  const acao = botao.dataset.acao;
  if (acao === 'criar-conta') criarConta(botao);
  else if (acao === 'conferir-codigo') conferirCodigo(botao);
  else if (acao === 'reenviar') comBotao(botao, pedirCodigo);
  else if (acao === 'buscar-cep') comBotao(botao, buscarCep);
  else if (acao === 'passo') gravarPasso(Number(botao.dataset.n), botao);
  else if (acao === 'enviar') enviar(botao);
  else if (acao === 'corrigir') mostrar(3);
  else if (acao === 'abre-termos') { ev.preventDefault(); }
});

// Enter no CEP busca, e nao envia nada.
$('[data-cep]')?.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') { ev.preventDefault(); buscarCep(); }
});
// Sair do campo de CNPJ dispara a consulta: pedir um clique a mais para algo
// que a pessoa nem sabe que existe faz o campo nunca ser usado.
$('#c-cnpj')?.addEventListener('blur', consultarCnpj);

(async function iniciar() {
  window.lucide && window.lucide.createIcons();
  pintarEscolhas();
  ligarEscolhas();
  ligarFotos();
  pintarFotos();

  // A taxa vem da MESMA constante que o resto do painel usa — dois numeros
  // escritos a mao divergem no dia em que a comissao mudar.
  const pct = String(Math.round(ARENA_FEE_RATE * 100));
  $$('[data-taxa], [data-taxa-2]').forEach((el) => { el.textContent = pct; });

  await montarEstados($('[data-uf]'));
  $('[data-uf]')?.addEventListener('change', (ev) => {
    pintarCidades($('[data-cidade]'), ev.target.value);
  });

  if (!(await retomar())) mostrar(1);
  window.lucide && window.lucide.createIcons();
})();
