/* Handshake com o Google — a unica camada descartavel do login.

   Hoje devolve uma credencial de teste. Quando existir o projeto no Google
   Cloud e os client IDs (Web, Android e iOS, mais a SHA-1 do keystore),
   troca-se a implementacao DAQUI DENTRO e nada fora deste arquivo muda:

     no navegador  -> Google Identity Services (accounts.id.initialize)
     no app        -> @codetrix-studio/capacitor-google-auth

   De proposito nao ha nenhum request externo enquanto GOOGLE_READY for
   false. Carregar o script do GIS sem client ID so renderia erro no console
   e vazaria o IP de quem abrisse o app. */

export const GOOGLE_READY = false;

/* Perfis de teste rotativos. Sempre devolver o mesmo email faria o mock de
   auth cair no atalho do gabriel@ e o cadastro novo nunca seria exercitado. */
const PERFIS_TESTE = [
  { name: 'Bruno Teixeira', email: 'bruno.teixeira@gmail.com' },
  { name: 'Ana Paula Ferraz', email: 'ana.ferraz@gmail.com' },
  { name: 'Diego Nunes', email: 'diego.nunes@gmail.com' }
];

let proximo = 0;

/* Devolve { idToken, profile }. O idToken vai cru para o backend, que e quem
   valida a assinatura — o cliente nunca decide quem a pessoa e. */
export async function requestGoogleCredential() {
  if (GOOGLE_READY) {
    throw new Error('Integração do Google ainda não configurada');
  }
  const profile = PERFIS_TESTE[proximo % PERFIS_TESTE.length];
  proximo += 1;
  return {
    idToken: `mock-google-id-token.${profile.email}`,
    profile: { ...profile, picture: '' }
  };
}

export default { GOOGLE_READY, requestGoogleCredential };
