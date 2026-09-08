/* Configuracao real do app do jogador para o webDir do Capacitor.

   DOIS DESTINOS, e o motivo de cada um:

   NO APK -> a API HOSPEDADA (https://api.qadras.com.br).
   O endereco fica compilado dentro do APK, e o IP da LAN muda toda vez que a
   maquina troca de rede — cada troca exigia recompilar e reinstalar, e o
   sintoma era sempre o mesmo "o app nao abre". Com um dominio fixo esse
   problema deixa de existir.

   NO NAVEGADOR -> o backend da propria maquina, na porta 8000.
   E onde se desenvolve: o erro aparece no log do servidor na hora, e um teste
   nao escreve no banco de producao. Servido por HTTP, a pagina fala com o
   MESMO host que a serviu — mudou de rede, continua funcionando sem editar
   arquivo nenhum.

   ATENCAO CORS: o Capacitor serve a pagina de http://localhost dentro do
   aparelho, e e ESSA a origem que chega na API. Se ela nao estiver em
   CORS_ORIGINS no servidor, TODO request e bloqueado pelo navegador e o
   sintoma volta a ser "nao conecta" — igual ao do IP errado, e por um motivo
   completamente diferente. Ver docs/DEPENDENCIAS-EXTERNAS.md, secao E.2. */
const API_HOSPEDADA = 'https://api.qadras.com.br';

/* So para depurar o APK contra o backend desta maquina: troque NO_APK para
   IP_DA_LAN, confira o IP com ipconfig e recompile. */
const IP_DA_LAN = 'http://192.168.0.19:8000';
const NO_APK = API_HOSPEDADA;

function enderecoDaApi() {
  const nativo = Boolean(window.Capacitor && window.Capacitor.isNativePlatform
    && window.Capacitor.isNativePlatform());
  if (nativo) return NO_APK;
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && location.hostname) {
    const host = location.hostname;
    // So em dev local a API vive na porta 8000. Fora dela (producao/staging,
    // servido por HTTPS/443) a API e a hospedada.
    if (host === 'localhost' || host === '127.0.0.1') {
      return `${location.protocol}//${host}:8000`;
    }
  }
  /* Aberto por file:// (raro, mas acontece ao abrir o HTML direto): sem host
     para derivar, a hospedada e a unica que responde de qualquer lugar. */
  return API_HOSPEDADA;
}

window.__PQ_CONFIG__ = {
  API_BASE_URL: enderecoDaApi(),
  STORAGE_PREFIX: 'pq',
  REQUIRE_LOGIN: true,
  APP_PUBLIC_URL: '',
  /* Client ID web do Google (Cloud Console > APIs e servicos > Credenciais).
     Vazio = botao "Entrar com Google" nao aparece e nenhum script do Google
     e baixado. Precisa bater com GOOGLE_CLIENT_ID do backend. */
  GOOGLE_CLIENT_ID: '784118699391-qa8qouo0o9lkurjsum3medpq0hpsdkp8.apps.googleusercontent.com'
};
