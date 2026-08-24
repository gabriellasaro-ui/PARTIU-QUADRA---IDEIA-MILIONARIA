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
        <i class="ic sm" data-lucide="image"></i>${court.fotos || 0}/5
      </span>
      ${court.photo
        ? `<img src="${escapeHtml(court.photo)}" alt="${escapeHtml(court.label)}" loading="lazy" data-foto-quadra>`
        : ''}
      <!-- QUADRA SEM FOTO nao vira um retangulo cinza morto.

           A vitrine exige cinco fotos, entao "sem foto" nao e um estado
           neutro: e a razao pela qual aquela quadra nao esta sendo reservada.
           O vazio vira convite, com o caminho para resolver — e nao um aviso
           de que falta algo, sem dizer onde. -->
      <a class="ph-vazio" href="./dashboard.html#quadra/${escapeHtml(String(court.id))}">
        <i class="ic lg" data-lucide="image-plus"></i>
        <strong>Adicionar fotos</strong>
        <small>Quadras com foto recebem mais reservas</small>
      </a>
    </div>
    <div class="bd">
      <h3>${escapeHtml(court.label)}</h3>
      <p class="meta"><i class="ic" data-lucide="layout-grid"></i>${escapeHtml(court.sport)} · ${formatCurrency(court.price)}/h</p>

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
        <!-- INTERRUPTOR, e nao botao.

             "Pausar" e um botao que diz o que VAI acontecer; o dono precisa
             saber o que ESTA acontecendo. Com dois cartoes lado a lado, um
             dizendo "Pausar" e outro "Ativar", ler qual das duas quadras esta
             no ar exige inverter cada rotulo na cabeca — o botao mostra o
             oposto do estado.

             O interruptor mostra o estado e muda no mesmo gesto. E a quadra
             pausada some da busca e do mapa do jogador (Court.is_active entra
             no filtro VISIBLE), por isso o rotulo diz o efeito. -->
        <label class="qcard-switch">
          <span>${court.active ? 'Ativa' : 'Pausada'}</span>
          <span class="switch${court.active ? ' on' : ''}" role="switch"
                aria-checked="${court.active}" tabindex="0"
                data-court-toggle="${court.id}"
                aria-label="${court.active ? 'Pausar' : 'Ativar'} ${escapeHtml(court.label)}"></span>
        </label>
      </div>
    </div>
  </article>`;
}

/* FOTO QUEBRADA NAO DEIXA O CARTAO EM BRANCO.

   O estado "sem foto" e escolhido por CSS (`.ph:not(:has(img))`), entao basta o
   <img> existir para ele sumir — mesmo que a imagem nao carregue. Resultado:
   quadra com URL morta virava um retangulo vazio, sem foto e sem o convite
   para adicionar uma, e nada na tela dizia o que estava errado.

   Acontece de verdade: link de hospedagem que expira, arquivo removido,
   celular offline. Tirando o <img> do DOM, o seletor volta a casar e o cartao
   mostra "Adicionar fotos", que e o que o dono precisa fazer.

   `capture: true` porque o evento `error` de <img> NAO borbulha — sem isso o
   listener no documento nunca seria chamado. */
function tratarFotoQuebrada(root) {
  root.addEventListener('error', (event) => {
    const img = event.target;
    if (img?.tagName === 'IMG' && img.closest('.qcard')) img.remove();
  }, { capture: true });
}

let fotoQuebradaLigada = false;

export async function renderManagerCourts(root) {
  if (!fotoQuebradaLigada) {
    tratarFotoQuebrada(document);
    fotoQuebradaLigada = true;
  }

  const carregado = API_BASE_URL ? await loadCourts() : { quadras: courts(), vitrine: null };
  const lista = carregado.quadras;
  const dadosVitrine = carregado.vitrine;

  const grid = root.querySelector('[data-court-list]');
  if (grid) {
    grid.innerHTML = lista.map(courtCard).join('')
      + `<a class="qcard add-card" href="./dashboard.html#quadra">
           <span class="add-ic"><i class="ic lg" data-lucide="plus"></i></span>
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

  // Vitrine: os toggles refletem o estado salvo, nao a classe escrita no HTML.
  const estado = showcase();
  root.querySelectorAll('[data-showcase-setting]').forEach((btn) => {
    const ligado = Boolean(estado[btn.dataset.showcaseSetting]);
    btn.classList.toggle('is-on', ligado);
    btn.setAttribute('aria-pressed', String(ligado));
  });

  /* A frase do cartao DIZ O ESTADO, em vez de repetir o que o interruptor ja
     mostra. Antes era "Controle a visibilidade e o destaque das suas quadras
     sem sair da gestao" — texto de folheto, igual com a arena visivel ou
     escondida. Agora ela muda, e desligado o aviso e o que importa: a arena
     sumiu da busca. */
  const frase = root.querySelector('[data-showcase-estado]');
  if (frase) {
    const visivel = Boolean(estado.visible);
    frase.textContent = visivel
      ? 'Sua arena aparece na busca e no mapa do app.'
      : 'Sua arena está escondida — ninguém encontra suas quadras no app.';
    frase.classList.toggle('is-off', !visivel);
  }


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
