/* Icones das modalidades — DESENHADOS, nao emprestados.

   Tres tentativas com nomes do Lucide falharam pelo mesmo motivo: a biblioteca
   nao tem esses esportes. O que existia era metafora — 'warehouse' (galpao)
   para futsal, 'umbrella' (guarda-chuva) para beach tennis, 'target' (alvo)
   para basquete. Ninguem olha um galpao e pensa "futsal".

   A exigencia real era: "futebol e amplo, tem que saber identificar qual
   esporte". Os tres futebois precisam se distinguir ENTRE SI, e nao apenas do
   volei. Aqui eles se separam pelo CAMPO, que e o que de fato muda entre eles:

     campo    bola + gol de trave alta e larga (campo aberto)
     society  bola + gol menor sobre linha de grama sintetica
     futsal   bola + quadra fechada (linhas laterais + teto)

   Traco de 1.75 e `currentColor` para acompanhar o texto ao lado, como os
   icones do Lucide fazem — assim convivem na mesma linha sem destoar.
   viewBox 24x24 pelo mesmo motivo. */

const BASE = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"'
  + ' stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

/* Bola de futebol: circulo + pentagono central + tres costuras saindo dele.
   E o unico jeito de nao virar "circulo generico" em 24px. */
const BOLA_FUTEBOL = `
  <circle cx="12" cy="12" r="9"/>
  <path d="M12 8.2l2.7 2-1 3.2h-3.4l-1-3.2z"/>
  <path d="M12 3v5.2M19.6 9.2l-4.9 1M17.1 19.1l-2.8-2.7M6.9 19.1l2.8-2.7M4.4 9.2l4.9 1"/>`;

/* Bola de volei: circulo + duas curvas em S, que e a leitura classica. */
const BOLA_VOLEI = `
  <circle cx="12" cy="12" r="9"/>
  <path d="M12 3c-3.3 3.4-4 8.6-1.7 12.9"/>
  <path d="M20.5 14.6c-4.6 1.3-9.4-.6-11.7-4.9"/>
  <path d="M6.6 19.9C9.5 16 14.2 14.4 18.7 16"/>`;

export const SPORT_SVG = {
  /* Campo: gol alto e largo ocupando a base — a trave de campo aberto. */
  'Futebol de Campo': `<svg ${BASE}>
      <circle cx="12" cy="8.5" r="4.6"/>
      <path d="M12 5.6l1.5 1.1-.6 1.8h-1.8l-.6-1.8z"/>
      <path d="M3 21v-5.2h18V21"/>
      <path d="M6.4 21v-5.2M17.6 21v-5.2M3 18.4h18"/>
    </svg>`,

  /* Society: mesmo gol, porem BAIXO e estreito, sobre a linha do sintetico.
     A diferenca de tamanho e o que separa society de campo. */
  'Futebol Society': `<svg ${BASE}>
      <circle cx="12" cy="8.5" r="4.6"/>
      <path d="M12 5.6l1.5 1.1-.6 1.8h-1.8l-.6-1.8z"/>
      <path d="M6.5 21v-3.4h11V21"/>
      <path d="M6.5 19.3h11"/>
      <path d="M3 21h18"/>
    </svg>`,

  /* Futsal: quadra FECHADA — teto e duas laterais. E o que o jogador ve. */
  Futsal: `<svg ${BASE}>
      <path d="M3 9.5l9-5.5 9 5.5"/>
      <path d="M4.5 9.5V21h15V9.5"/>
      <circle cx="12" cy="15" r="3.6"/>
      <path d="M12 12.7l1.2.9-.5 1.4h-1.4l-.5-1.4z"/>
    </svg>`,

  Volei: `<svg ${BASE}>${BOLA_VOLEI}</svg>`,

  /* Futvolei: bola de volei sobre a REDE, com a areia embaixo. A rede e o que
     distingue de volei de quadra num icone deste tamanho. */
  Futvolei: `<svg ${BASE}>
      <circle cx="12" cy="7.5" r="4.4"/>
      <path d="M12 3.1c-1.6 1.7-2 4.2-.8 6.3M16.2 9.3c-2.2.6-4.6-.3-5.7-2.4"/>
      <path d="M3 14h18"/>
      <path d="M3 14v5M21 14v5"/>
      <path d="M7.5 14v5M12 14v5M16.5 14v5M3 16.5h18"/>
      <path d="M3 21h18"/>
    </svg>`,

  /* Beach tennis: raquete OVAL e curta, com furos — nao tem cordas cruzadas. */
  'Beach Tennis': `<svg ${BASE}>
      <ellipse cx="11" cy="9" rx="6" ry="7"/>
      <path d="M8.6 7.4h.01M13.4 7.4h.01M8.6 10.6h.01M13.4 10.6h.01M11 9h.01"/>
      <path d="M11 16v3.5"/>
      <path d="M9.4 21h3.2"/>
      <circle cx="19" cy="17.5" r="2"/>
    </svg>`,

  /* Tenis: raquete redonda com CORDAS cruzadas e cabo longo. */
  Tenis: `<svg ${BASE}>
      <ellipse cx="10.5" cy="8.5" rx="5.8" ry="6.5"/>
      <path d="M6.4 5.6l8.2 5.8M14.6 5.6l-8.2 5.8"/>
      <path d="M10.5 15v3.6l-1.6 2.4"/>
      <circle cx="18.5" cy="17" r="2.2"/>
    </svg>`,

  /* Basquete: bola com as costuras em cruz + arcos laterais. */
  Basquete: `<svg ${BASE}>
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 3v18M3 12h18"/>
      <path d="M5.6 5.6c3.5 3.5 3.5 9.3 0 12.8"/>
      <path d="M18.4 5.6c-3.5 3.5-3.5 9.3 0 12.8"/>
    </svg>`,

  /* Fallback: bola de futebol, o esporte mais provavel no produto. */
  _padrao: `<svg ${BASE}>${BOLA_FUTEBOL}</svg>`
};

/* Acentos: o backend as vezes manda "Futvôlei"/"Tênis" e as vezes sem acento,
   entao a busca ignora diacritico em vez de exigir a grafia exata. */
const semAcento = (valor) => String(valor ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const POR_CHAVE = new Map(
  Object.entries(SPORT_SVG).map(([nome, svg]) => [semAcento(nome), svg])
);

export function sportIcon(sport, className = 'ic ic-sport') {
  const svg = POR_CHAVE.get(semAcento(sport)) || SPORT_SVG._padrao;
  return `<span class="${className}" aria-hidden="true">${svg}</span>`;
}

export function temIconeProprio(sport) {
  return POR_CHAVE.has(semAcento(sport));
}
