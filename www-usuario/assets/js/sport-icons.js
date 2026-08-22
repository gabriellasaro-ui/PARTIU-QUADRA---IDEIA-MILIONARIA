/* Icones das modalidades — os PNG que o Gabriel desenhou (pasta /icons).

   Historico curto: primeiro foram nomes do Lucide, que nao tem esses esportes
   (dos 2003 icones existem so Goal, Volleyball, Medal e Trophy) — deu galpao
   para futsal e guarda-chuva para beach tennis. Depois foram SVG meus, que
   tambem nao agradaram. Agora sao os arquivos dele, que e a fonte certa: quem
   decide como o produto se parece nao sou eu.

   Os tres futebois se distinguem, que era a exigencia principal:
     campo    -> o campo visto de cima
     society  -> a bola em movimento
     futsal   -> o quadro tatico (futebol de SALAO)

   COMO ENTRAM NA TELA: como MASCARA (-webkit-mask), nao como <img>.

   Os arquivos sao linha preta em fundo transparente. Como <img>, ficariam
   pretos sempre — invisiveis no modo escuro e brigando com o verde da marca
   quando o chip esta selecionado. Como mascara, o desenho vira recorte e a
   cor sai de `currentColor`: acompanha o texto ao lado em qualquer tema, do
   mesmo jeito que o icone do Pix ja faz. */

/* ABSOLUTO, a partir da raiz do documento.

   Com './assets/...' o navegador resolvia o url() a partir da FOLHA DE ESTILO
   (/assets/css/mobile-v2.css) e nao do documento, virando
   /assets/css/assets/images/sports/... — 404, e o icone sumia por completo.
   Uma barra na frente resolve, e vale igual no app (localhost/) e na web. */
const BASE = '/assets/images/sports/';

/* Nome do esporte -> arquivo. Varios esportes podem apontar para o mesmo
   desenho quando nao ha um proprio; o fallback e 'outros', que e justamente
   o icone de varias bolas. */
const ARQUIVOS = {
  'Futebol de Campo': 'futebol',
  'Futebol Society': 'society',
  Futsal: 'salao',
  Volei: 'volei',
  Futvolei: 'volei',
  Tenis: 'tenis',
  'Beach Tennis': 'tenis',
  Basquete: 'outros'
};

const PADRAO = 'outros';

/* Acentos: o backend as vezes manda "Futvôlei"/"Tênis" e as vezes sem acento,
   entao a busca ignora diacritico em vez de exigir a grafia exata. */
const semAcento = (valor) => String(valor ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const POR_CHAVE = new Map(
  Object.entries(ARQUIVOS).map(([nome, arquivo]) => [semAcento(nome), arquivo])
);

export function arquivoDoEsporte(sport) {
  return POR_CHAVE.get(semAcento(sport)) || PADRAO;
}

export function sportIcon(sport, className = 'ic-sport') {
  const arquivo = arquivoDoEsporte(sport);
  /* A URL vai inline porque o conjunto de esportes vem do servidor e pode
     crescer sem tocar no CSS. O valor e um nome de arquivo escolhido pelo
     mapa acima, nunca texto vindo da API — entao nao ha o que injetar aqui. */
  return `<span class="${className}" aria-hidden="true"`
    + ` style="--ic-sport-img:url('${BASE}${arquivo}.png')"></span>`;
}

export function temIconeProprio(sport) {
  return POR_CHAVE.has(semAcento(sport));
}
