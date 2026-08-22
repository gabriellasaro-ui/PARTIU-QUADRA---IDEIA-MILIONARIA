/* Minhas quadras — os espacos DESTA arena.

   A versao anterior listava venueService.list(), que devolve as 6 arenas do
   marketplace. Errado: o gerente nao administra a concorrencia. Aqui ele ve
   Society 1, Society 2 e Areia, que sao as quadras dentro da arena dele.

   Duas metades, como no app antigo:
   - Vitrine no Explorar: como a arena aparece para o jogador, com os numeros
     que justificam mexer nisso (visualizacoes, conversao) e a previa real.
   - Espacos cadastrados: o catalogo, com ocupacao e preco de cada quadra.

   Preço e status ficam em storage, entao o que a arena edita persiste. */
import { ARENA, COURTS } from '../../config/manager-data.js';
import storage from '../../storage/storage.js';
import { formatCurrency } from '../../utils/formatters.js';
import { API_BASE_URL } from '../../config/constants.js';
import managerService from '../../services/manager-api.js';

const COURTS_KEY = 'manager-courts';
const SHOWCASE_KEY = 'manager-showcase';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

/* Os dados base sao fixos; o gerente so sobrescreve preco e status. Guardar
   o override em vez da quadra inteira evita que uma mudanca no catalogo
   fique presa atras de uma copia velha no localStorage. */
const overrides = () => storage.get(COURTS_KEY, {});

export function courts() {
  const over = overrides();
  const base = COURTS.map((court) => ({ ...court, ...(over[court.id] || {}) }));
  // Quadras que o gerente cadastrou existem so no override — sem isto elas
  // seriam salvas e desapareceriam no proximo render.
  const novas = Object.values(over).filter((c) => c.label && !COURTS.some((b) => b.id === c.id));
  return [...base, ...novas];
}

export function saveCourt(id, patch) {
  const over = overrides();
  over[id] = { ...(over[id] || {}), ...patch };
  storage.set(COURTS_KEY, over);
}

/* Quadras vivas: /api/gerente/quadras quando houver API.

   ATENCAO ao formato: devolve {quadras, vitrine}, e nao um array.

   A vitrine e o par de numeros do topo da tela (procura e conversao), que
   antes era constante escrita a mao. Quando mudei o retorno para trazer os
   dois juntos, DOIS consumidores continuaram tratando o resultado como array
   e quebraram — Mensalistas com "opcoesQuadras.map is not a function" e
   Configuracoes com "listaQuadras.filter is not a function". Quem chamar
   daqui em diante precisa do `.quadras`. */
export async function loadCourts() {
  if (!API_BASE_URL) return { quadras: courts(), vitrine: null };
  return managerService.quadras();
}

export const showcase = () => ({
  visible: ARENA.visible,
  featured: ARENA.featured,
  ...storage.get(SHOWCASE_KEY, {})
});

function courtCard(court) {
  const mensal = Number(court.priceMonthly || court.price * 4);
  return `<article class="qcard" data-court="${court.id}">
    <div class="ph">
      <span class="pill tl status ${court.active ? 'pago' : 'pendente'}">${court.active ? 'Ativa' : 'Pausada'}</span>
      <!-- CONTAGEM DE FOTOS, e o aviso quando faltam.

           A vitrine exige cinco: uma foto so nao vende quadra, porque quem
           escolhe onde jogar quer ver o piso, a iluminacao e o vestiario. O
           selo diz quantas ha, e fica AMBAR quando falta — o dono descobre o
           problema no catalogo, e nao quando percebe que ninguem reserva
           aquela quadra.

           (Este comentario vive DENTRO de um template literal: nada de crase
           aqui. Uma crase no meio de um comentario fecha a string e derruba a
           tela inteira com "Unexpected identifier" — foi o que aconteceu.) -->
      <span class="pill tr qcard-fotos${(court.fotos || 0) >= 5 ? '' : ' falta'}">
        <svg class="ic sm"><use href="#i-image"/></svg>${court.fotos || 0}/5
      </span>
      ${court.photo
        ? `<img src="${escapeHtml(court.photo)}" alt="${escapeHtml(court.label)}" loading="lazy" data-foto-quadra>`
        : ''}
      <span class="ph-vazio"><svg class="ic"><use href="#i-image"/></svg>Sem foto</span>
    </div>
    <div class="bd">
      <h3>${escapeHtml(court.label)}</h3>
      <p class="meta"><svg class="ic"><use href="#i-grid"/></svg>${escapeHtml(court.sport)} · ${formatCurrency(court.price)}/h</p>

      <div class="qcard-prices">
        <div><small>Avulso</small><strong>${formatCurrency(court.price)}<span> /hora</span></strong></div>
        <div><small>Mensalista</small><strong>${formatCurrency(mensal)}<span> /mês</span></strong></div>
      </div>

      <div class="faixa">
        <div class="faixa-top"><span>Ocupação</span><b>${court.occupancy}%</b></div>
        <div class="faixa-bar"><span style="width:${court.occupancy}%"></span></div>
      </div>

      <div class="foot">
        <a class="btn btn-soft" href="./dashboard.html#quadra/${court.id}">Editar</a>
        <button class="btn btn-outline" type="button" data-court-toggle="${court.id}">${court.active ? 'Pausar' : 'Ativar'}</button>
      </div>
    </div>
  </article>`;
}

export async function renderManagerCourts(root) {
  const carregado = API_BASE_URL ? await loadCourts() : { quadras: courts(), vitrine: null };
  const lista = carregado.quadras;
  const dadosVitrine = carregado.vitrine;

  const grid = root.querySelector('[data-court-list]');
  if (grid) {
    grid.innerHTML = lista.map(courtCard).join('')
      + `<a class="qcard add-card" href="./dashboard.html#quadra">
           <span class="add-ic"><svg class="ic lg"><use href="#i-plus"/></svg></span>
           <strong>Adicionar quadra</strong>
           <small>Cadastre mais um espaço da sua arena</small>
         </a>`;
  }

  const contador = root.querySelector('[data-court-count]');
  if (contador) {
    const ativas = lista.filter((c) => c.active).length;
    contador.textContent = `${lista.length} quadras cadastradas · ${ativas} ativas`;
  }

  /* Numeros da vitrine: do SERVIDOR, e nao de constante escrita a mao.

     Eram ARENA.views30d e ARENA.conversion — invencao apresentada como
     medicao, e o dono decidiria pagar por destaque olhando para elas.

     Sem procura registrada a conversao sai como "—", e nao como "0%": zero
     por cento afirma que ninguem converteu; travessao diz que ainda nao da
     para saber, que e a verdade quando nao houve procura nenhuma. */
  const vitrine = dadosVitrine || {};
  const views = root.querySelector('[data-showcase-views]');
  if (views) views.textContent = Number(vitrine.procura || 0).toLocaleString('pt-BR');
  const conv = root.querySelector('[data-showcase-conversion]');
  if (conv) {
    conv.textContent = vitrine.conversao === null || vitrine.conversao === undefined
      ? '—'
      : `${String(vitrine.conversao).replace('.', ',')}%`;
  }

  // (O bloco de destaque regional saiu da tela: simulava uma COMPRA que
  //  nao existia em lugar nenhum. Ver o comentario em quadras.html.)
  root.querySelector('[data-boost]')?.classList.toggle('is-on', Boolean(ativo));

  // Vitrine: os toggles refletem o estado salvo, nao a classe escrita no HTML.
  const estado = showcase();
  root.querySelectorAll('[data-showcase-setting]').forEach((btn) => {
    const ligado = Boolean(estado[btn.dataset.showcaseSetting]);
    btn.classList.toggle('is-on', ligado);
    btn.setAttribute('aria-pressed', String(ligado));
  });


  tratarFotosQuebradas(root);
  window.pqRefreshIcons?.(root);
}

export function initManagerCourts() {
  document.addEventListener('click', async (event) => {
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root) return;

    // Pausar/ativar e a unica edição que vale a pena fazer sem sair da
    // lista. O resto abre o formulario completo, que e uma pagina.
    const toggle = event.target.closest('[data-court-toggle]');
    if (toggle) {
      const court = (API_BASE_URL ? (await loadCourts()).quadras : courts())
        .find((c) => String(c.id) === toggle.dataset.courtToggle);
      if (!court) return;
      if (API_BASE_URL) {
        try {
          await managerService.atualizarQuadra(court.id, { ativa: !court.active });
        } catch (error) {
          window.pqToast?.(error.message || 'Não foi possível salvar');
          return;
        }
      } else {
        saveCourt(court.id, { active: !court.active });
      }
      await renderManagerCourts(root);
      window.pqToast?.(court.active ? `${court.label} pausada` : `${court.label} ativada`);
      return;
    }


    const setting = event.target.closest('[data-showcase-setting]');
    if (setting) {
      const chave = setting.dataset.showcaseSetting;
      const estado = showcase();
      storage.set(SHOWCASE_KEY, { ...estado, [chave]: !estado[chave] });
      renderManagerCourts(root);
    }
  });
}


/* Foto quebrada vira o estado "sem foto", e nao o icone de imagem partida.

   Em JS e nao com onerror inline: atributo de evento dentro de HTML gerado
   por template e exatamente onde uma aspa ou uma crase fora do lugar derruba
   a tela — foi o que aconteceu na primeira versao disto. */
export function tratarFotosQuebradas(root) {
  root.querySelectorAll('[data-foto-quadra]').forEach((img) => {
    if (img.dataset.tratada) return;
    img.dataset.tratada = '1';
    const falhou = () => {
      /* ESCONDE o <img>, nao so tira o src.

         Sem src o elemento continua no fluxo e o navegador desenha o TEXTO
         ALTERNATIVO — "Society 2" flutuando no canto do cartao, por cima do
         estado "Sem foto" que deveria estar ali. Duas mensagens sobrepostas
         dizendo a mesma ausencia. */
      img.hidden = true;
      img.removeAttribute('src');
      img.closest('.ph')?.classList.add('sem-foto');
    };
    img.addEventListener('error', falhou);
    // Imagem que ja falhou antes do listener existir (cache, src invalido).
    if (img.complete && img.naturalWidth === 0) falhou();
  });
}
