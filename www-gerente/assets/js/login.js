/* Login do painel do gerente — a pagina em si e login.html; aqui so o envio.

   Com API_BASE_URL vazio o botao nao faz nada e avisa: sem backend nao ha
   sessao valida. Com backend, o /api/auth/login devolve { token, user } e a
   pessoa segue para o dashboard. */
import authService from '../../services/auth.js';
import { API_BASE_URL } from '../../config/constants.js';
import { aplicarTema } from '../../services/tema.js';

aplicarTema();

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

function redirect() {
  const params = new URLSearchParams(location.search);
  const next = params.get('next') || './dashboard.html';
  location.assign(next);
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
