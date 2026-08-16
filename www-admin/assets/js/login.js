/* Login do painel do admin — a pagina e login.html; aqui so o envio.

   Com API_BASE_URL vazio o botao nao faz nada e avisa: sem backend nao ha
   sessao valida. Com backend, o /api/auth/login devolve { token, user } e a
   pessoa segue para o painel. */
import authService from '../services/auth.js';
import { API_BASE_URL } from '../config/constants.js';

function redirect() {
  const params = new URLSearchParams(location.search);
  const next = params.get('next') || './index.html';
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
