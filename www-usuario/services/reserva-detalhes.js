/* Detalhes da reserva num modal, compartilhado por web e app.

   O botao "Detalhes" (e, no app, o proprio card) levava para a PAGINA DA
   QUADRA — que e a vitrine de venda, com seletor de data e horario. Quem ja
   tem a reserva nao quer comprar de novo: quer conferir onde e, quando e, e o
   codigo para mostrar na portaria. Sao perguntas diferentes.

   Vive num modulo proprio porque web e app precisam do MESMO conteudo, e
   duplicar garantiria que um dos dois ficasse para tras na primeira mudanca.

   Estilo inline pelo mesmo motivo do overlay do Pix: nao depender de classe
   de CSS que pode nao existir num dos dois apps, e nao poder quebrar layout
   nenhum. */

function moeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function escapar(texto) {
  return String(texto == null ? '' : texto).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

/**
 * @param {object} reserva  payload de /api/reservas
 * @param {object} extras   { endereco, foto } — o que so quem chamou sabe
 */
export function abrirDetalhesDaReserva(reserva, extras = {}) {
  if (!reserva) return;

  const foto = extras.foto || reserva.image || '';
  const linhas = [
    ['Local', reserva.venueName],
    ['Endereço', extras.endereco || reserva.neighborhood],
    ['Esporte', reserva.sport],
    ['Data', reserva.date],
    ['Horário', reserva.hour + (reserva.endHour ? ' às ' + reserva.endHour : '')],
    ['Duração', (reserva.duration || 1) + 'h'],
    ['Código', reserva.code],
    ['Status', reserva.status],
    ['Valor', moeda(reserva.price)],
  ];

  const fundo = document.createElement('div');
  fundo.setAttribute('role', 'dialog');
  fundo.setAttribute('aria-modal', 'true');
  fundo.setAttribute('aria-label', 'Detalhes da reserva');
  fundo.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:9998',
    'background:rgba(12,16,12,.72)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'padding:16px', 'overflow:auto',
  ].join(';');

  fundo.innerHTML = [
    '<div style="background:#fff;color:#12200f;border-radius:20px;max-width:460px;width:100%;',
    'overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.35)">',
    foto
      ? '<img src="' + escapar(foto) + '" alt="' + escapar(reserva.venueName || '')
        + '" style="width:100%;height:180px;object-fit:cover;display:block">'
      : '',
    '<div style="padding:20px 22px 22px">',
    '<h2 style="margin:0 0 14px;font-size:20px;line-height:1.25">Sua reserva</h2>',
    '<dl style="margin:0;display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:14px">',
    linhas.filter((l) => l[1]).map((l) => (
      '<dt style="opacity:.6;white-space:nowrap">' + escapar(l[0]) + '</dt>'
      + '<dd style="margin:0;text-align:right;font-weight:600">' + escapar(l[1]) + '</dd>'
    )).join(''),
    '</dl>',
    '<button type="button" data-fechar-detalhes',
    ' style="width:100%;margin-top:18px;padding:13px;border:0;border-radius:12px;cursor:pointer;',
    'background:#7ed321;color:#12200f;font-weight:700;font-size:15px">Fechar</button>',
    '</div></div>',
  ].join('');

  const travaScroll = document.body.style.overflow;

  function fechar() {
    document.body.style.overflow = travaScroll;
    document.removeEventListener('keydown', aoTeclar);
    fundo.remove();
  }
  function aoTeclar(ev) {
    if (ev.key === 'Escape') fechar();
  }

  document.body.style.overflow = 'hidden';
  document.body.appendChild(fundo);
  document.addEventListener('keydown', aoTeclar);
  fundo.querySelector('[data-fechar-detalhes]').addEventListener('click', fechar);
  /* Clicar fora fecha, mas so no fundo: clique dentro do cartao nao conta. */
  fundo.addEventListener('click', (ev) => { if (ev.target === fundo) fechar(); });
}

export default { abrirDetalhesDaReserva };
