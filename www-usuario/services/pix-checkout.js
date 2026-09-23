/* A etapa que faltava: o jogador de fato PAGAR.

   O fluxo antigo chamava /pagar e descartava a resposta — o QR voltava e ia
   para o lixo. Fazia sentido quando o provider era o mock: a cobranca se
   confirmava sozinha em segundos e nao havia nada para a pessoa fazer. Com o
   Mercado Pago de verdade, a tela pulava direto para "aguardando aprovacao"
   e o Pix nunca aparecia.

   POR QUE UM OVERLAY, e nao uma rota ou uma tela nova: o desktop e o mobile
   tem sistemas de renderizacao proprios e bem diferentes, e cada um monta a
   confirmacao do seu jeito. Uma tela nova exigiria escrever (e manter) duas.
   O overlay entra por cima do que ja esta na tela, espera, e sai — os dois
   fluxos ganham UMA linha e nada do que existe muda de comportamento.

   O preco disso: sair da tela perde o QR. A reserva continua viva pelos 15
   minutos e o pagamento segue existindo no backend, mas a pessoa precisa
   refazer para ver o codigo. Uma rota propria resolveria; e o passo seguinte
   quando isso incomodar.
*/
import api from './api.js';
import { API_BASE_URL } from '../config/constants.js';

/* De quanto em quanto tempo perguntamos ao servidor se o Pix caiu. 3s e o
   equilibrio entre parecer instantaneo e nao martelar a API. */
const INTERVALO_MS = 3000;

function moeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function contagem(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/* Estilo inline de proposito: nao depender de classe de CSS que pode nao
   existir num dos dois apps, nem obrigar a editar folha de estilo para o
   overlay aparecer certo. Isolado assim, ele nao pode quebrar layout nenhum. */
function montar(pagamento) {
  const fundo = document.createElement('div');
  fundo.setAttribute('role', 'dialog');
  fundo.setAttribute('aria-modal', 'true');
  fundo.setAttribute('aria-label', 'Pagamento via Pix');
  fundo.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:rgba(12,16,12,.72)', 'backdrop-filter:blur(2px)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'padding:16px', 'overflow:auto',
  ].join(';');

  const imagem = pagamento.qrCodeImage || '';
  const copiaECola = pagamento.qrCode || '';

  fundo.innerHTML = `
    <div style="background:#fff;color:#12200f;border-radius:20px;max-width:420px;width:100%;
                padding:24px;box-shadow:0 24px 60px rgba(0,0,0,.35);font-family:inherit;text-align:center">
      <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.6">Pague para confirmar</p>
      <h2 style="margin:0 0 4px;font-size:24px;line-height:1.2">Pix de ${moeda(pagamento.amount)}</h2>
      <p style="margin:0 0 16px;font-size:14px;opacity:.7">
        Expira em <strong data-pix-contagem>--:--</strong>
      </p>

      ${imagem
        ? `<img src="${imagem}" alt="QR Code do Pix" width="220" height="220"
             style="width:220px;height:220px;display:block;margin:0 auto 16px;border-radius:12px">`
        : ''}

      <label style="display:block;text-align:left;font-size:13px;opacity:.7;margin:0 0 6px">Pix copia e cola</label>
      <textarea readonly data-pix-codigo rows="3"
        style="width:100%;box-sizing:border-box;font-size:12px;font-family:ui-monospace,monospace;
               padding:10px;border:1px solid #d6ded2;border-radius:10px;resize:none;background:#f7faf5"
      >${copiaECola}</textarea>

      <button type="button" data-pix-copiar
        style="width:100%;margin:10px 0 0;padding:13px;border:0;border-radius:12px;cursor:pointer;
               background:#7ed321;color:#12200f;font-weight:700;font-size:15px">Copiar código</button>

      <p data-pix-aviso style="margin:14px 0 0;font-size:13px;opacity:.7">
        Assim que o pagamento cair, esta tela avança sozinha.
      </p>

      <button type="button" data-pix-fechar
        style="margin:12px 0 0;background:none;border:0;color:#5a6b52;font-size:13px;
               text-decoration:underline;cursor:pointer">Pagar depois</button>
    </div>`;
  return fundo;
}

/**
 * Mostra o Pix e resolve quando o pagamento sair do estado pendente.
 *
 * Devolve 'pago' | 'expirado' | 'adiado'. O chamador decide o que fazer com
 * cada um — aqui nao se navega para lugar nenhum, justamente para nao
 * interferir no fluxo de quem chamou.
 */
export function cobrarPix(pagamento) {
  // Sem QR nao ha o que mostrar: e o caso do provider mock, que se confirma
  // sozinho, e o de API desligada. Resolver na hora mantem o comportamento
  // ANTIGO intacto nesses cenarios — e o que garante que isto nao quebra nada.
  if (!API_BASE_URL || !pagamento || !pagamento.qrCode) {
    return Promise.resolve('pago');
  }

  return new Promise((resolve) => {
    const overlay = montar(pagamento);
    document.body.appendChild(overlay);
    const travaScroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const expiraEm = pagamento.expiresAt ? new Date(pagamento.expiresAt).getTime() : (Date.now() + 15 * 60 * 1000);
    let timerContagem = null;
    let timerPoll = null;
    let encerrado = false;

    function encerrar(resultado) {
      if (encerrado) return;
      encerrado = true;
      if (timerContagem) window.clearInterval(timerContagem);
      if (timerPoll) window.clearInterval(timerPoll);
      document.body.style.overflow = travaScroll;
      overlay.remove();
      resolve(resultado);
    }

    overlay.querySelector('[data-pix-copiar]')?.addEventListener('click', async (ev) => {
      const campo = overlay.querySelector('[data-pix-codigo]');
      try {
        await navigator.clipboard.writeText(campo.value);
      } catch {
        // Navegador sem permissao de clipboard (ou http): a selecao manual
        // continua funcionando, e e melhor que um erro na cara da pessoa.
        campo.select();
      }
      ev.currentTarget.textContent = 'Código copiado';
      window.setTimeout(() => { ev.currentTarget.textContent = 'Copiar código'; }, 2000);
    });

    overlay.querySelector('[data-pix-fechar]')?.addEventListener('click', () => encerrar('adiado'));

    timerContagem = window.setInterval(() => {
      const restante = expiraEm - Date.now();
      const alvo = overlay.querySelector('[data-pix-contagem]');
      if (alvo) alvo.textContent = contagem(restante);
      if (restante <= 0) {
        const aviso = overlay.querySelector('[data-pix-aviso]');
        if (aviso) aviso.textContent = 'O código expirou. Refaça a reserva para gerar outro.';
        encerrar('expirado');
      }
    }, 1000);

    timerPoll = window.setInterval(async () => {
      try {
        const dados = await api.get(`/api/payments/${pagamento.id}`);
        const estado = dados?.payment?.status;
        if (estado && estado !== 'pending') {
          encerrar(estado === 'confirmed' ? 'pago' : 'expirado');
        }
      } catch {
        // Falha de rede: tenta de novo no proximo ciclo. Nao derruba a tela,
        // porque o Pix pode ja ter sido pago e so a consulta falhou.
      }
    }, INTERVALO_MS);
  });
}

export default { cobrarPix };
