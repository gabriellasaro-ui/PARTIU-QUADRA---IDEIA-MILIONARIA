/* Handshake com o Google — a unica camada descartavel do login.

   Duas portas, porque o Google trata web e app como mundos diferentes:

     navegador -> Google Identity Services (accounts.google.com/gsi/client)
     app       -> @codetrix-studio/capacitor-google-auth  (ainda por fazer)

   Nada fora deste arquivo muda quando a segunda porta chegar: quem chama so
   conhece o { idToken, profile } que sai daqui.

   Enquanto GOOGLE_CLIENT_ID estiver vazio nao ha UM request externo. Baixar
   o script do GIS sem client ID so renderia erro no console e vazaria o IP
   de quem abrisse o app.

   O idToken vai cru para o backend, que e quem confere a assinatura com o
   Google — o cliente nunca decide quem a pessoa e. */

import { GOOGLE_CLIENT_ID } from '../config/constants.js';

export const GOOGLE_READY = Boolean(GOOGLE_CLIENT_ID);

const GIS_SRC = 'https://accounts.google.com/gsi/client';

let carregando = null;

/* Carrega o GIS uma vez por pagina. Varias chamadas simultaneas esperam a
   mesma promessa em vez de injetar <script> duplicado. */
function carregarGis() {
  if (!GOOGLE_READY) {
    return Promise.reject(new Error('Login com Google ainda não configurado'));
  }
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (carregando) return carregando;

  carregando = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.id) resolve(window.google);
      else reject(new Error('Google carregou mas não expôs accounts.id'));
    };
    script.onerror = () => {
      /* Deixa tentar de novo: sem isso um bloqueador de anuncio ou uma
         queda de rede travaria o botao para sempre nesta aba. */
      carregando = null;
      reject(new Error('Não foi possível carregar o Google'));
    };
    document.head.appendChild(script);
  });
  return carregando;
}

/* O GIS entrega o perfil dentro do proprio idToken (um JWT). Ler o payload
   aqui e so para preencher nome e foto na interface enquanto o backend
   responde — nao vale como prova de identidade, e por isso nada de decidir
   permissao com o que sai daqui. */
function perfilDoToken(idToken) {
  try {
    const payload = idToken.split('.')[1];
    /* atob devolve bytes; o percent-encoding no meio e o que faz acento de
       nome brasileiro sobreviver. escape() faria o mesmo e esta obsoleto. */
    const bytes = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const json = decodeURIComponent(
      bytes.split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    );
    const dados = JSON.parse(json);
    return { name: dados.name || '', email: dados.email || '', picture: dados.picture || '' };
  } catch {
    return { name: '', email: '', picture: '' };
  }
}

let iniciado = false;
let pendente = null;   /* espera do caminho programatico (prompt/One Tap) */
let aoReceber = null;  /* ouvinte do botao desenhado pelo Google */

/* O GIS so aceita UM callback global, entao ele cai aqui e daqui e repartido
   entre os dois caminhos. A espera pontual tem prioridade: se alguem chamou
   prompt() e esta parado esperando, e dela a resposta. */
function entregar(resposta) {
  const credencial = resposta?.credential
    ? { idToken: resposta.credential, profile: perfilDoToken(resposta.credential) }
    : null;

  const espera = pendente;
  pendente = null;
  if (espera) {
    if (credencial) espera.resolve(credencial);
    else espera.reject(new Error('O Google não devolveu credencial'));
    return;
  }
  if (aoReceber && credencial) aoReceber(credencial);
}

function iniciar(google) {
  if (iniciado) return;
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: entregar,
    /* FedCM e o caminho que o Chrome mantem depois do fim dos cookies de
       terceiros; sem isso o One Tap morre silenciosamente. */
    use_fedcm_for_prompt: true,
    cancel_on_tap_outside: false
  });
  iniciado = true;
}

/* Desenha o botao oficial do Google dentro de `container`.

   E o caminho confiavel na web: o popup de escolha de conta so abre a partir
   do botao que o proprio Google renderiza. Um botao nosso chamando prompt()
   depende do One Tap, que o navegador pode suprimir sem avisar.

   Resolve com { idToken, profile } quando a pessoa escolhe a conta. */
export async function mountGoogleButton(container, opcoes = {}) {
  const google = await carregarGis();
  iniciar(google);

  /* Ouvinte, e nao promessa: o botao continua clicavel depois de uma troca
     que falhou, e uma promessa de uso unico deixaria o segundo clique sem
     ninguem para atender. */
  if (typeof opcoes.onCredential === 'function') aoReceber = opcoes.onCredential;

  google.accounts.id.renderButton(container, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: opcoes.text || 'continue_with',
    shape: 'rectangular',
    logo_alignment: 'center',
    locale: 'pt-BR',
    width: opcoes.width || container.clientWidth || 320
  });
}

/* Caminho programatico: usado pelos botoes proprios do mobile e, mais tarde,
   pelo plugin do Capacitor. Na web depende do One Tap, que o navegador pode
   recusar — dai o erro explicito em vez de um botao que nao faz nada. */
export async function requestGoogleCredential() {
  const google = await carregarGis();
  iniciar(google);

  return new Promise((resolve, reject) => {
    if (pendente) pendente.reject(new Error('Tentativa substituída'));
    pendente = { resolve, reject };

    google.accounts.id.prompt((aviso) => {
      if (aviso?.isNotDisplayed?.() || aviso?.isSkippedMoment?.()) {
        pendente = null;
        reject(new Error('Escolha de conta indisponível. Use o botão do Google.'));
      }
    });
  });
}

export default { GOOGLE_READY, requestGoogleCredential, mountGoogleButton };
