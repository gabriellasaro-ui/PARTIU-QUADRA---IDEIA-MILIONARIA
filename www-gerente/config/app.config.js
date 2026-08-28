/* Configuracao real do app do gerente para o webDir do Capacitor.

   API_BASE_URL EM DUAS SITUACOES, e por um motivo pratico:

   No APK a pagina e servida pelo Capacitor em http://localhost/, e "localhost"
   dentro do celular e o proprio celular — o backend nao esta la. Por isso o
   endereco precisa ser o IP da maquina na LAN, e ele fica compilado no APK.

   No NAVEGADOR o mesmo IP e desnecessario e vira armadilha: o IP da LAN muda
   ao trocar de rede, e ai o painel aberto em localhost:5175 tenta falar com
   um IP que nao existe mais e "nao carrega nada". Isso ja custou varias
   rodadas de investigacao. Servido por HTTP, a pagina passa a falar com o
   MESMO host que a serviu, na porta 8000 — mudou de rede, continua funcionando
   sem editar arquivo nenhum.

   Em producao troque a constante por https://api.qadras.com.br.

   ATENCAO: o IP abaixo ainda vale para o APK. Confira com ipconfig quando o
   aparelho nao conectar — e a primeira coisa a olhar. */
const IP_DA_LAN = 'http://192.168.0.19:8000';

function enderecoDaApi() {
  const nativo = Boolean(window.Capacitor && window.Capacitor.isNativePlatform
    && window.Capacitor.isNativePlatform());
  if (nativo) return IP_DA_LAN;
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && location.hostname) {
    return `${location.protocol}//${location.hostname}:8000`;
  }
  return IP_DA_LAN;
}

window.__PQ_CONFIG__ = {
  API_BASE_URL: enderecoDaApi(),
  STORAGE_PREFIX: 'pqg',
  /* MESMO projeto Google do app do jogador — um so client ID para a conta
     inteira. O que muda entre os dois nao e a credencial, e a ORIGEM: o
     Google so devolve token para origens autorizadas no console, e o painel
     roda numa porta diferente. Sem a origem do painel na lista, o botao
     aparece e o clique nao volta.

     Vazio desliga o Google inteiro: nao baixa o script, nao faz um request. */
  GOOGLE_CLIENT_ID: '784118699391-qa8qouo0o9lkurjsum3medpq0hpsdkp8.apps.googleusercontent.com'
};
