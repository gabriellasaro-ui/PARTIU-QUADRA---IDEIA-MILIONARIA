/* Login do painel do gerente — a pagina em si e login.html; aqui so o envio.

   Com API_BASE_URL vazio o botao nao faz nada e avisa: sem backend nao ha
   sessao valida. Com backend, o /api/auth/login devolve { token, user } e a
   pessoa segue para o dashboard. */
import api from '../../services/api.js';
import authService from '../../services/auth.js';
import { API_BASE_URL } from '../../config/constants.js';
import { aplicarTema } from '../../services/tema.js';

/* CLARO fixo nesta pagina, e nao o tema guardado.

   `aplicarTema()` sem argumento REMOVE o data-theme quando a preferencia
   salva e escura — e a pagina de login, que so funciona no claro (a
   ilustracao depende de `mix-blend-mode: multiply`), voltaria ao escuro
   logo depois de pintar. O tema da pessoa continua valendo no painel. */
aplicarTema('light');

/* O <script> do Lucide vem com `defer`, entao pode nao ter rodado quando este
   modulo executa. Sem esta chamada os <i data-lucide> ficam vazios e o cartao
   de cadastro aparece sem icone nenhum. */
function desenharIcones() {
  window.lucide && window.lucide.createIcons();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', desenharIcones);
} else {
  desenharIcones();
}

/* PARA ONDE O GERENTE VAI DEPOIS DE ENTRAR.

   Nao e sempre o painel. Desde que existe cadastro de arena, um gerente pode
   ter conta e NAO ter arena: a ficha esta em rascunho, esperando analise, ou
   foi recusada. Mandar essa pessoa para o dashboard a deixa num painel que nao
   tem arena para mostrar — faturamento zero, agenda vazia, e nada na tela
   dizendo que o cadastro dela ainda nem foi aprovado. E a tela que parece
   defeito.

   A pergunta e uma so: existe ficha, e ela ja virou arena?

     404          -> nao ha ficha: e dono de arena antigo, vai para o painel
     aprovada     -> a arena existe, vai para o painel
     qualquer outra -> volta para o cadastro, que sabe abrir no passo certo
                       (ou na tela de "recebemos seu pedido")

   `next=` continua mandando quando alguem chegou aqui por uma rota protegida:
   ali a pessoa pediu um lugar especifico. */
async function destinoDoGerente() {
  const params = new URLSearchParams(location.search);
  const pedido = params.get('next');
  if (pedido) return pedido;

  const user = authService.currentUser();
  if (user && user.role !== 'gerente') return './dashboard.html';

  try {
    const ficha = await api.get('/api/arenas/solicitacao/minha');
    return ficha.status === 'aprovada' ? './dashboard.html' : './cadastro.html';
  } catch (erro) {
    /* 404 e o caminho NORMAL de quem ja tem arena — nao ha ficha porque a
       conta nasceu antes do cadastro existir. Qualquer outra falha (rede,
       servidor fora) tambem cai aqui, e mandar para o painel e a escolha
       segura: ele mostra o proprio erro, enquanto o cadastro reabriria um
       formulario que a pessoa talvez ja tenha enviado. */
    return './dashboard.html';
  }
}

async function redirect() {
  location.assign(await destinoDoGerente());
}

if (authService.hasSession()) {
  redirect();
}

document.querySelectorAll('[data-login-form]').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = form.querySelector('[data-login-error]');
    const submit = form.querySelector('[type="submit"]');

    if (!API_BASE_URL) {
      errorBox.textContent = 'Backend ainda não conectado.';
      return;
    }

    if (submit) submit.setAttribute('disabled', 'disabled');
    try {
      await authService.login(Object.fromEntries(new FormData(form)));
      redirect();
    } catch (error) {
      errorBox.textContent = error.message || 'Não foi possível entrar';
      if (submit) submit.removeAttribute('disabled');
    }
  });
});

/* ══════════ ENTRAR COM O GOOGLE ═══════════════════════════════════════════

   O botao e desenhado pelo PROPRIO Google: na web e o unico jeito confiavel
   de abrir a escolha de conta. Um botao nosso dependeria do One Tap, que o
   navegador pode suprimir sem avisar — e ai o clique nao faz nada e nao ha
   erro para mostrar.

   Sem client ID, entra a previa desabilitada no lugar. A tela fica completa
   sem prometer um caminho que ainda nao existe.

   A diferenca em relacao ao app do jogador esta na RECUSA, nao no sucesso:
   aqui uma conta Google sem arena nao vira conta nova. O backend responde 404
   ("cadastre sua arena") ou 403 ("esta conta e de jogador"), e o texto vai
   inteiro para a caixa de erro — e a unica pista que a pessoa tem de que
   errou de porta. */
(async () => {
  const area = document.querySelector('[data-google-area]');
  const alvo = document.querySelector('[data-google-button]');
  const previa = document.querySelector('[data-google-previa]');
  const erro = document.querySelector('[data-login-error]');
  if (!area || !alvo || !previa) return;

  const { GOOGLE_READY, mountGoogleButton } = await import('../../services/google-auth.js');
  area.hidden = false;

  /* Sem backend nao ha sessao para trocar a credencial: o botao do Google
     abriria a escolha de conta e morreria na volta. Melhor nem oferecer. */
  if (!GOOGLE_READY || !API_BASE_URL) {
    previa.hidden = false;
    return;
  }
  alvo.hidden = false;

  try {
    await mountGoogleButton(alvo, {
      text: 'signin_with',
      onCredential: async (credencial) => {
        if (erro) erro.textContent = '';
        try {
          await authService.exchangeGoogleCredential(credencial);
          redirect();
        } catch (falha) {
          if (erro) erro.textContent = falha.message || 'Não foi possível entrar com o Google';
        }
      }
    });
  } catch (falha) {
    /* Google fora do ar, bloqueador de anuncio, ou origem nao autorizada no
       console: cai na previa em vez de deixar um vazio no meio do cartao. */
    alvo.hidden = true;
    previa.hidden = false;
  }
})();
