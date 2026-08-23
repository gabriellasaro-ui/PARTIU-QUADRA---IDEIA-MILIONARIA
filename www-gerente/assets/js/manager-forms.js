/* Formularios do gerente: nova reserva, cadastro de quadra e configurações.

   Sao as tres telas de formulario do app antigo. As duas primeiras nunca
   tinham sido portadas; a terceira tinha perdido metade dos blocos.

   Os switches sao `<span class="switch">` do CSS antigo, nao <input>. Eles
   nao entram no FormData sozinho — cada tela le o estado deles na mao. */
import {
  ARENA_PROFILE, ARENA_COUPONS, SPORTS, AMENITIES
} from '../../config/manager-data.js';
import { courts, loadCourts, saveCourt } from './manager-courts.js';
import { addBooking, setPageMeta } from './manager-bookings.js';
import storage from '../../storage/storage.js';
import { API_BASE_URL } from '../../config/constants.js';
import managerService from '../../services/manager-api.js';
import authService from '../../services/auth.js';
import { ligarParEstadoCidade } from '../../services/localidades.js';

const PROFILE_KEY = 'manager-profile';
const COUPONS_KEY = 'manager-coupons';
const AMENITIES_KEY = 'manager-amenities';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

const profile = () => ({ ...ARENA_PROFILE, ...storage.get(PROFILE_KEY, {}) });
const coupons = () => storage.get(COUPONS_KEY, ARENA_COUPONS);

/* Data ISO para o backend. O campo aceita "Hoje" / "Amanhã" / texto livre;
   a API so entende YYYY-MM-DD, entao normalize o que da e caia em hoje. */
function dataISO(valor) {
  const v = String(valor || '').trim();
  if (!v || v.toLowerCase() === 'hoje') return new Date().toISOString().slice(0, 10);
  if (v.toLowerCase() === 'amanhã' || v.toLowerCase() === 'amanha') {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  const parse = new Date(`${v}T12:00:00`);
  return Number.isNaN(parse.getTime()) ? new Date().toISOString().slice(0, 10) : parse.toISOString().slice(0, 10);
}

const horas = (de, ate, selecionada) => {
  let html = '';
  for (let h = de; h <= ate; h += 1) {
    const rotulo = `${String(h).padStart(2, '0')}:00`;
    html += `<option${h === selecionada ? ' selected' : ''}>${rotulo}</option>`;
  }
  return html;
};

/* Liga um switch visual: sem <input> por tras, o estado e a classe. */
function pintarSwitch(el, ligado) {
  el.classList.toggle('on', Boolean(ligado));
  el.setAttribute('aria-checked', String(Boolean(ligado)));
}

// ---------------------------------------------------------------- nova reserva

export async function renderManagerBookingForm(root) {
  const form = root.querySelector('[data-booking-form]');
  if (!form) return;

  const quadras = root.querySelector('[data-booking-courts]');
  if (quadras) quadras.innerHTML = (API_BASE_URL ? (await loadCourts()).quadras : courts()).map((c) => `<option>${escapeHtml(c.label)}</option>`).join('');

  const inicio = root.querySelector('[data-booking-hours]');
  if (inicio) inicio.innerHTML = horas(6, 23, 19);

  window.pqRefreshIcons?.(root);
}

// ------------------------------------------------------------- cadastro quadra

/* O id vem do hash: #quadra/2 edita; #quadra sozinho cadastra. */
const courtIdFromHash = () => (location.hash.split('/')[1] || '').trim();

export async function renderManagerCourtForm(root) {
  const form = root.querySelector('[data-court-form]');
  if (!form) return;

  const id = courtIdFromHash();
  const lista = API_BASE_URL ? (await loadCourts()).quadras : courts();
  const quadra = id ? lista.find((c) => String(c.id) === id) : null;

  /* A galeria comeca com as fotos que a quadra JA tem.

     Sem isto, editar o preco enviaria uma lista vazia e apagaria as cinco
     fotos existentes — e o backend recusaria com "envie pelo menos 5", o que
     e ainda mais confuso: o dono ve o erro numa tela onde as fotos estao
     visivelmente la. */
  definirFotos(quadra?.fotosLista || [], root);

  setPageMeta(
    quadra ? `Editar ${quadra.label}` : 'Cadastrar quadra',
    quadra ? 'Ajuste os dados do espaço' : 'Adicione um novo espaço à sua arena'
  );

  const esportes = root.querySelector('[data-court-sports]');
  if (esportes) {
    esportes.innerHTML = SPORTS.map((s) =>
      `<option${quadra && quadra.sport === s ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('');
  }
  const abre = root.querySelector('[data-court-open]');
  if (abre) abre.innerHTML = horas(6, 15, quadra?.abre ?? 8);
  const fecha = root.querySelector('[data-court-close]');
  if (fecha) fecha.innerHTML = horas(16, 23, quadra?.fecha ?? 23);

  /* COMODIDADES DESTA QUADRA, e nao as da arena inteira.

     A lista marcada vem de `quadra.comodidades` (servidor). As sugestoes
     padrao aparecem sempre, e qualquer comodidade gravada que nao esteja entre
     elas entra como pastilha propria — senao editar uma quadra com
     "churrasqueira" perderia o item calado. */
  marcadas = new Set((quadra?.comodidades || []).map(String));
  pintarComodidades(root);

  // O expediente pertence a uma quadra que ja existe: sem id nao ha onde
  // pendurar os sete dias, e o editor diz isso em vez de fingir que salva.
  await carregarExpediente(root, quadra?.id);

  form.elements.id.value = quadra?.id || '';
  form.elements.label.value = quadra?.label || '';
  /* O LOCAL vem do cadastro da arena, e e so leitura.

     O formulario pedia "Bairro" por quadra. As quadras de uma arena ficam no
     mesmo endereco, entao o campo so criava divergencia. Aqui ele mostra o que
     esta em Configuracoes, para o dono conferir sem poder desencontrar. */
  const local = root.querySelector('[data-local-arena]');
  if (local) {
    try {
      const perfil = API_BASE_URL ? await managerService.perfil() : ARENA_PROFILE;
      const partes = [perfil.bairro, perfil.cidade, perfil.estado].filter(Boolean);
      local.value = partes.length ? partes.join(' · ') : 'Defina em Configurações';
    } catch (error) {
      local.value = 'Defina em Configurações';
    }
  }
  form.elements.descricao.value = quadra?.descricao || '';
  form.elements.price.value = quadra?.price ?? 120;
  form.elements.priceMonthly.value = quadra?.priceMonthly ?? 408;

  const foto = root.querySelector('[data-court-photo]');
  if (foto) {
    foto.textContent = quadra ? '' : '+';
    foto.style.backgroundImage = quadra ? `url('${quadra.photo}')` : '';
    foto.style.backgroundSize = 'cover';
    foto.style.backgroundPosition = 'center';
  }
  const rotuloFoto = root.querySelector('[data-court-photo-label]');
  if (rotuloFoto) rotuloFoto.textContent = quadra ? 'Trocar foto' : 'Enviar foto';

  const ativo = root.querySelector('[data-switch="active"]');
  if (ativo) pintarSwitch(ativo, quadra ? quadra.active : true);

  const enviar = root.querySelector('[data-court-submit]');
  if (enviar) enviar.textContent = quadra ? 'Salvar alterações' : 'Cadastrar quadra';

  window.pqRefreshIcons?.(root);
}

/* AS COMODIDADES MARCADAS da quadra em edicao.

   Modulo e nao DOM: o formulario e remontado a cada visita de rota, e guardar
   no elemento faria a selecao sumir na primeira re-renderizacao. */
let marcadas = new Set();

function pintarComodidades(root) {
  const caixa = root.querySelector('[data-court-amenities]');
  if (!caixa) return;
  // Sugestoes + o que ja estava gravado, sem repetir.
  const todas = [...new Set([...AMENITIES.map((a) => a.label), ...marcadas])];
  caixa.innerHTML = todas.map((label) => `
    <button type="button" class="comodidade${marcadas.has(label) ? ' on' : ''}" data-amenity="${escapeHtml(label)}">
      <i class="ic sm" data-lucide="${marcadas.has(label) ? 'check' : 'plus'}"></i>${escapeHtml(label)}
    </button>`).join('');
  window.pqRefreshIcons?.(caixa);
}

function comodidadesDoFormulario() {
  return [...marcadas];
}

/* ═══════════════ EXPEDIENTE DA QUADRA — sete dias ════════════════════════

   O formulario tinha UM par "abre as / fecha as" para a semana inteira. Arena
   que so abre a noite na segunda ou nao abre domingo nao tinha como dizer — e
   a tabela por dia da semana existia no banco desde a fase 1, sem rota que a
   alcancasse. */

/* Estado do editor. Modulo e nao DOM, pelo mesmo motivo das comodidades: a
   tela e remontada a cada visita de rota. */
let expedienteDias = [];

const HORAS_DIA = Array.from({ length: 25 }, (_, h) => String(h).padStart(2, '0') + ':00');

function opcoesHora(selecionada) {
  return HORAS_DIA.map((h) =>
    `<option value="${h}"${h === selecionada ? ' selected' : ''}>${h}</option>`).join('');
}

function pintarExpediente(root) {
  const caixa = root.querySelector('[data-expediente]');
  if (!caixa) return;

  if (!expedienteDias.length) {
    /* Quadra ainda nao criada nao tem expediente: nao ha id para pendurar os
       dias. Dizer isso e melhor do que mostrar sete linhas que nao salvam. */
    caixa.innerHTML = '<p class="expediente__aviso">Cadastre a quadra primeiro. Depois você define o horário de cada dia da semana aqui.</p>';
    return;
  }

  caixa.innerHTML = expedienteDias.map((d) => `
    <div class="exp-dia${d.fechado ? ' is-fechado' : ''}" data-exp-dia="${d.dia}">
      <label class="exp-dia__nome">
        <input type="checkbox" data-exp-aberto ${d.fechado ? '' : 'checked'}>
        <span>${escapeHtml(d.rotulo)}</span>
      </label>
      ${d.fechado
        ? '<span class="exp-dia__fechado">Fechado</span>'
        : `<div class="exp-dia__horas">
             <select data-exp-abre aria-label="Abre">${opcoesHora(d.abre)}</select>
             <span>até</span>
             <select data-exp-fecha aria-label="Fecha">${opcoesHora(d.fecha)}</select>
           </div>`}
      <button type="button" class="exp-dia__copiar" data-exp-copiar title="Aplicar este horário aos outros dias abertos">
        <i class="ic sm" data-lucide="copy"></i>
      </button>
    </div>`).join('');
  window.pqRefreshIcons?.(caixa);
}

async function carregarExpediente(root, quadraId) {
  if (!API_BASE_URL || !quadraId) {
    expedienteDias = [];
    pintarExpediente(root);
    return;
  }
  try {
    const dados = await managerService.expediente(quadraId);
    expedienteDias = dados.dias || [];
  } catch (error) {
    expedienteDias = [];
  }
  pintarExpediente(root);
}

// ------------------------------------------------------------------ configurações

/* UM CUPOM, DUAS FORMAS.

   O cartao lia `c.code`, `c.discount` e `c.expires` — os nomes que o
   localStorage usa quando nao ha API. O servidor devolve `codigo`, `desconto`
   e `expiraEm`, entao com o backend ligado (que e o caso real) TODO cupom
   aparecia como "undefined% de desconto · válido até", sem codigo e sem data.
   O aria-label do botao de remover saia vazio junto.

   A normalizacao fica AQUI, num lugar so, e nao espalhada em `a ?? b` por
   campo: quem escrever o proximo cartao le uma forma unica. */
function normalizarCupom(c) {
  return {
    id: c.id,
    codigo: c.codigo ?? c.code ?? '',
    desconto: c.desconto ?? c.discount ?? 0,
    expira: c.expiraEm ?? c.expires ?? '',
    quadra: c.quadra ?? 'Todas as quadras',
    usos: c.usos ?? 0,
    ativo: c.ativo !== false
  };
}

async function renderCupons(root) {
  const lista = root.querySelector('[data-coupon-list]');
  if (!lista) return;
  const atuais = (API_BASE_URL ? await managerService.cupons() : coupons()).map(normalizarCupom);
  lista.innerHTML = atuais.length
    ? atuais.map((c) => `<article class="manager-coupon${c.ativo ? '' : ' inativo'}" data-coupon-id="${escapeHtml(c.id)}">
        <span><i class="ic" data-lucide="gift"></i></span>
        <div>
          <strong>${escapeHtml(c.codigo)}</strong>
          <!-- QUANTAS VEZES FOI USADO: o servidor ja contava e a tela jogava
               fora. E o unico numero que responde se a campanha funcionou —
               sem ele o dono nao tem como decidir renovar ou encerrar. -->
          <small>${escapeHtml(String(c.desconto))}% de desconto · ${escapeHtml(c.quadra)}${
            c.expira ? ` · até ${escapeHtml(formatarData(c.expira))}` : ' · sem prazo'
          } · ${c.usos} ${c.usos === 1 ? 'uso' : 'usos'}</small>
        </div>
        <button type="button" data-coupon-remove="${escapeHtml(c.id)}" aria-label="Remover cupom ${escapeHtml(c.codigo)}"><i class="ic sm" data-lucide="x"></i></button>
      </article>`).join('')
    : '<p class="panel-sub">Nenhuma campanha ativa. Um cupom ajuda a preencher os horários mais vazios.</p>';
  window.pqRefreshIcons?.(lista);
}

const formatarData = (iso) => {
  const [a, m, d] = String(iso).split('-');
  return d ? `${d}/${m}` : iso;
};

export async function renderManagerSettings(root) {
  const form = root.querySelector('[data-settings-form]');
  if (!form) return;

  // Com API o perfil e as configuracoes vivem no backend; sem API, storage.
  let dados;
  if (API_BASE_URL) {
    const [perfilApi, configApi] = await Promise.all([
      managerService.perfil(),
      managerService.configuracoes()
    ]);
    dados = {
      ...ARENA_PROFILE,
      ...perfilApi,
      notificaReserva: configApi.notificaReserva,
      notificaPagamento: configApi.notificaPagamento,
      notificaAvaliacao: configApi.notificaAvaliacao,
      notificaResumo: configApi.notificaResumo,
      // O interruptor da arena sai de `is_active` no servidor. Sem ler de
      // volta, quem pausasse veria o botao ligado de novo na proxima visita.
      pausada: configApi.pausada
    };
  } else {
    dados = profile();
  }

  const esportes = root.querySelector('[data-settings-sports]');
  if (esportes) {
    esportes.innerHTML = SPORTS.map((s) =>
      `<option${dados.esporte === s ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('');
  }

  ['nome', 'descricao', 'endereco', 'telefone', 'email', 'pixTipo', 'pixChave', 'pixTitular']
    .forEach((campo) => {
      if (form.elements[campo]) form.elements[campo].value = dados[campo] ?? '';
    });

  // Contagem real das quadras ativas — no template antigo era "2" fixo, e
  // desencontrava de Minhas quadras assim que a arena pausasse uma.
  const listaQuadras = API_BASE_URL ? (await loadCourts()).quadras : courts();
  if (form.elements.quadrasAtivas) {
    form.elements.quadrasAtivas.value = listaQuadras.filter((c) => c.active).length;
  }

  root.querySelectorAll('[data-switch]').forEach((el) => {
    const chave = el.dataset.switch;
    if (chave.startsWith('amenity:')) return;
    pintarSwitch(el, dados[chave]);
  });

  const seletor = root.querySelector('[data-coupon-courts]');
  if (seletor) {
    seletor.innerHTML = '<option>Todas as quadras</option>'
      + listaQuadras.map((c) => `<option>${escapeHtml(c.label)}</option>`).join('');
  }

  /* ESTADO E CIDADE encadeados, com os valores ja gravados selecionados.

     Roda depois de preencher o resto do formulario: `ligarParEstadoCidade`
     monta as 27 UFs, carrega os municipios da UF atual e religa o onchange.
     Chamar antes deixaria a cidade certa apagada pelo preenchimento. */
  const selUf = root.querySelector('[data-uf]');
  const selCidade = root.querySelector('[data-cidade]');
  if (selUf && selCidade) {
    await ligarParEstadoCidade(selUf, selCidade, {
      uf: dados.estado || '',
      cidade: dados.cidade || ''
    });
  }

  await renderCupons(root);
  window.pqRefreshIcons?.(root);
}

// ------------------------------------------------------------------------ eventos

export function initManagerForms() {
  /* A BARRA DE SALVAR aparece quando o formulario fica sujo.

     Delegado no documento porque a tela e remontada a cada visita de rota:
     um listener preso ao <form> morreria junto com ele. `capture: true` para
     pegar tambem os switches, que chamam preventDefault no clique.

     `change` alem de `input`: select e input[type=file] nao emitem `input` em
     todos os navegadores. */
  const sujar = (event) => {
    const form = event.target.closest?.('[data-settings-form]');
    if (!form) return;
    const barra = form.querySelector('[data-form-actions]');
    if (barra) barra.hidden = false;
  };
  /* Enter no campo de comodidade adiciona em vez de submeter o formulario.
     Sem isso, digitar "churrasqueira" e apertar Enter salvaria a quadra sem a
     comodidade — o gesto mais natural fazendo a coisa errada. */
  document.addEventListener('keydown', (event) => {
    const campo = event.target.closest?.('[data-amenity-novo]');
    if (!campo || event.key !== 'Enter') return;
    event.preventDefault();
    document.querySelector('[data-amenity-add]')?.click();
  });

  /* O editor de expediente guarda no estado do modulo a cada mexida: a lista
     e reimpressa em varios momentos (copiar, fechar dia), e ler do DOM na hora
     de salvar perderia o que tivesse sido reimpresso no meio. */
  document.addEventListener('change', (event) => {
    const linha = event.target.closest?.('[data-exp-dia]');
    if (!linha) return;
    const dia = expedienteDias.find((d) => String(d.dia) === linha.dataset.expDia);
    if (!dia) return;
    const root = document.querySelector('[data-desktop-route-view]');
    if (event.target.matches('[data-exp-aberto]')) {
      dia.fechado = !event.target.checked;
      pintarExpediente(root);
    } else if (event.target.matches('[data-exp-abre]')) {
      dia.abre = event.target.value;
    } else if (event.target.matches('[data-exp-fecha]')) {
      dia.fecha = event.target.value;
    }
  });

  document.addEventListener('input', sujar);
  document.addEventListener('change', sujar);
  /* O interruptor de tema NAO suja o formulario: ele grava sozinho, no toque,
     e ficou fora do "Salvar" de proposito. Mostrar a barra depois dele diria
     que falta confirmar algo que ja aconteceu. */
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-cfg-tema]')) return;
    if (event.target.closest('[data-settings-form] .switch')) sujar(event);
  }, true);

  document.addEventListener('click', async (event) => {
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root) return;

    /* SAIR DA CONTA precisa LIMPAR A SESSAO, e nao so trocar de pagina.

       Era `<a href="./index.html">`: o token continuava no storage, e a
       proxima pessoa a abrir o painel naquele computador entrava como o dono
       da arena. O computador do balcao e compartilhado por definicao. */
    /* COPIAR HORARIO para os outros dias abertos.

       Quem abre 8h-23h todo dia teria de mexer em catorze selects. O botao
       existe porque o caso comum e "a semana e igual, menos domingo": define
       um dia, copia, e ajusta a excecao. Nao mexe em dia FECHADO — copiar
       horario para um dia que o dono desligou seria reabrir a quadra sem ele
       pedir. */
    const copiar = event.target.closest('[data-exp-copiar]');
    if (copiar) {
      event.preventDefault();
      const linha = copiar.closest('[data-exp-dia]');
      const origem = expedienteDias.find((d) => String(d.dia) === linha.dataset.expDia);
      if (!origem || origem.fechado) return;
      expedienteDias = expedienteDias.map((d) =>
        d.fechado ? d : { ...d, abre: origem.abre, fecha: origem.fecha });
      pintarExpediente(root);
      root.querySelector('[data-form-actions]')?.removeAttribute('hidden');
      window.pqToast?.('Horário aplicado aos dias abertos');
      return;
    }

    const pastilha = event.target.closest('[data-amenity]');
    if (pastilha) {
      event.preventDefault();
      const label = pastilha.dataset.amenity;
      if (marcadas.has(label)) marcadas.delete(label);
      else marcadas.add(label);
      pintarComodidades(root);
      // Marcar comodidade e alteracao: a barra de salvar tem de aparecer.
      root.querySelector('[data-form-actions]')?.removeAttribute('hidden');
      return;
    }

    if (event.target.closest('[data-amenity-add]')) {
      event.preventDefault();
      const campo = root.querySelector('[data-amenity-novo]');
      const texto = (campo?.value || '').trim();
      if (!texto) return;
      /* Comparacao sem diferenciar caixa: sem isso "Vestiario" e "vestiario"
         viram duas pastilhas e o app do jogador mostra a mesma coisa duas
         vezes. Mantem o que a pessoa digitou, mas nao duplica o que ja existe. */
      const existente = [...marcadas, ...AMENITIES.map((a) => a.label)]
        .find((l) => l.toLowerCase() === texto.toLowerCase());
      marcadas.add(existente || texto);
      if (campo) campo.value = '';
      pintarComodidades(root);
      root.querySelector('[data-form-actions]')?.removeAttribute('hidden');
      return;
    }

    if (event.target.closest('[data-logout]')) {
      event.preventDefault();
      try {
        await authService.logout();
      } finally {
        // Mesmo se a rota de logout falhar, a sessao local ja saiu: ficar
        // logado por causa de uma falha de rede e o pior dos dois resultados.
        window.location.replace('./index.html');
      }
      return;
    }

    if (event.target.closest('[data-deactivate]')) {
      event.preventDefault();
      const dlg = root.querySelector('[data-deactivate-dialog]');
      if (dlg) dlg.hidden = false;
      window.pqRefreshIcons?.(dlg || root);
      return;
    }

    if (event.target.closest('[data-deactivate-cancel]')) {
      event.preventDefault();
      const dlg = root.querySelector('[data-deactivate-dialog]');
      if (dlg) dlg.hidden = true;
      return;
    }

    // Um switch alterna na hora; o valor so e gravado quando o form e salvo.
    const chave = event.target.closest('[data-switch]');
    if (chave) {
      event.preventDefault();
      pintarSwitch(chave, !chave.classList.contains('on'));
      return;
    }

    if (event.target.closest('[data-coupon-new]')) {
      root.querySelector('[data-coupon-dialog]').hidden = false;
      return;
    }
    if (event.target.closest('[data-coupon-cancel]')) {
      root.querySelector('[data-coupon-dialog]').hidden = true;
      return;
    }

    const remover = event.target.closest('[data-coupon-remove]');
    if (remover) {
      const id = remover.dataset.couponRemove;
      if (API_BASE_URL) {
        try {
          await managerService.excluirCupom(id);
        } catch (error) {
          window.pqToast?.(error.message || 'Não foi possível remover');
          return;
        }
      } else {
        storage.set(COUPONS_KEY, coupons().filter((c) => c.id !== id));
      }
      await renderCupons(root);
      window.pqToast?.('Cupom removido');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const chave = event.target.closest?.('[data-switch]');
    if (!chave) return;
    event.preventDefault();
    pintarSwitch(chave, !chave.classList.contains('on'));
  });

  document.addEventListener('submit', async (event) => {
    const root = document.querySelector('[data-desktop-route-view]');

    const reserva = event.target.closest('[data-booking-form]');
    if (reserva) {
      event.preventDefault();
      if (!reserva.reportValidity()) return;
      const d = new FormData(reserva);
      const inicio = String(d.get('inicio'));
      const dur = Number(d.get('duracao'));
      const fim = `${String(Math.floor(Number(inicio.split(':')[0]) + dur)).padStart(2, '0')}:${dur % 1 ? '30' : '00'}`;

      if (API_BASE_URL) {
        try {
          const quadras = (await loadCourts()).quadras;
          const quadra = String(d.get('quadra'));
          const courtId = quadras.find((c) => c.label === quadra)?.id || quadras[0]?.id;
          await managerService.criarReservaManual({
            courtId,
            date: dataISO(String(d.get('data'))),
            hora: inicio,
            dur,
            clientName: String(d.get('cliente')).trim(),
            clientPhone: String(d.get('telefone')).trim(),
            valor: Number(d.get('valor'))
          });
        } catch (error) {
          window.pqToast?.(error.message || 'Não foi possível criar');
          return;
        }
        window.pqToast?.('Reserva criada');
        location.hash = '#reservas';
        return;
      }

      const id = `nova-${Date.now()}`;
      addBooking({
        id,
        codigo: `PQ-${String(Date.now()).slice(-4)}`,
        cliente: String(d.get('cliente')).trim(),
        telefone: String(d.get('telefone')).trim(),
        quadra: String(d.get('quadra')),
        data: String(d.get('data')).trim(),
        hora: `${inicio} – ${fim}`,
        valor: Number(d.get('valor')),
        status: String(d.get('status'))
      });
      window.pqToast?.('Reserva criada');
      location.hash = '#reservas';
      return;
    }

    const quadra = event.target.closest('[data-court-form]');
    if (quadra) {
      event.preventDefault();
      if (!quadra.reportValidity()) return;
      const d = new FormData(quadra);

      if (API_BASE_URL) {
        const id = String(d.get('id') || '').trim();
        const body = {
          nome: String(d.get('label')).trim(),
          esporte: String(d.get('sport')),
          descricao: String(d.get('descricao')).trim(),
          preco: Number(d.get('price')),
          abertura: String(d.get('abre')),
          fechamento: String(d.get('fecha')),
          ativa: root.querySelector('[data-switch="active"]')?.classList.contains('on') ?? true,
          /* AS FOTOS FALTAVAM NO CORPO.

             O backend exige cinco desde a fase 2 e o formulario nunca as
             enviava — nem uma. A regra existia dos dois lados e nao se
             encontrava no meio: o campo mandava tudo menos justamente o que
             era obrigatorio. */
          fotos: fotosDoFormulario(),
          /* COMODIDADES tambem faltavam no corpo. O backend guarda a lista por
             quadra desde a fase 2 e o formulario nunca a mandou — os cinco
             interruptores gravavam no localStorage e morriam ali. */
          comodidades: comodidadesDoFormulario()
        };
        try {
          if (id) {
            await managerService.atualizarQuadra(id, body);
            /* O EXPEDIENTE E OUTRA ROTA, salva junto do resto.

               Duas chamadas e nao uma porque sao dois recursos: a quadra e uma
               linha em `courts`, o expediente sao sete em
               `court_recurring_availability`. Pendurar a semana no PATCH da
               quadra misturaria os dois e faria o corpo carregar dado que a
               maioria dos salvamentos nao mexe.

               Salvo DEPOIS da quadra: se o PATCH falhar, nao adianta ter
               gravado horario para uma quadra que nao aceitou a alteracao. */
            if (expedienteDias.length) {
              await managerService.salvarExpediente(id, expedienteDias.map((d) => ({
                dia: d.dia,
                fechado: d.fechado,
                abre: d.abre,
                fecha: d.fecha
              })));
            }
          } else {
            await managerService.criarQuadra(body);
          }
        } catch (error) {
          window.pqToast?.(error.message || 'Não foi possível salvar');
          return;
        }
        window.pqToast?.('Quadra salva');
        location.hash = '#quadras';
        return;
      }

      const id = Number(d.get('id')) || Date.now();
      const anterior = courts().find((c) => c.id === id);
      saveCourt(id, {
        id,
        label: String(d.get('label')).trim(),
        sport: String(d.get('sport')),
        descricao: String(d.get('descricao')).trim(),
        price: Number(d.get('price')),
        priceMonthly: Number(d.get('priceMonthly')),
        abre: Number(String(d.get('abre')).split(':')[0]),
        fecha: Number(String(d.get('fecha')).split(':')[0]),
        active: root.querySelector('[data-switch="active"]')?.classList.contains('on') ?? true,
        occupancy: anterior?.occupancy ?? 0,
        photo: anterior?.photo || courts()[0].photo
      });
      storage.set(AMENITIES_KEY, AMENITIES.map((a) => ({
        ...a,
        on: root.querySelector(`[data-switch="amenity:${a.id}"]`)?.classList.contains('on') ?? a.on
      })));
      window.pqToast?.('Quadra salva');
      location.hash = '#quadras';
      return;
    }

    const config = event.target.closest('[data-settings-form]');
    if (config) {
      event.preventDefault();
      const d = new FormData(config);

      if (API_BASE_URL) {
        try {
          await managerService.atualizarPerfil({
            nome: String(d.get('nome') ?? ''),
            descricao: String(d.get('descricao') ?? ''),
            endereco: String(d.get('endereco') ?? ''),
            bairro: String(d.get('bairro') ?? ''),
            cidade: String(d.get('cidade') ?? ''),
            estado: String(d.get('estado') ?? ''),
            telefone: String(d.get('telefone') ?? ''),
            email: String(d.get('email') ?? '')
            // `pixChave` saiu junto com o cartao de Recebimento: mandar um
            // campo que a tela nao coleta apagaria a chave ja gravada.
          });
          const configs = {};
          root.querySelectorAll('[data-switch]').forEach((el) => {
            if (!el.dataset.switch.startsWith('amenity:')) {
              configs[el.dataset.switch] = el.classList.contains('on');
            }
          });
          await managerService.atualizarConfiguracoes(configs);
        } catch (error) {
          window.pqToast?.(error.message || 'Não foi possível salvar');
          return;
        }
        root.querySelector('[data-form-actions]')?.setAttribute('hidden', '');
        window.pqToast?.('Configurações salvas');
        return;
      }

      const salvo = { ...profile() };
      ['nome', 'esporte', 'descricao', 'endereco', 'telefone', 'email', 'pixTipo', 'pixChave', 'pixTitular']
        .forEach((campo) => { salvo[campo] = String(d.get(campo) ?? ''); });
      root.querySelectorAll('[data-switch]').forEach((el) => {
        if (!el.dataset.switch.startsWith('amenity:')) {
          salvo[el.dataset.switch] = el.classList.contains('on');
        }
      });
      storage.set(PROFILE_KEY, salvo);
      window.pqToast?.('Configurações salvas');
      return;
    }

    const desat = event.target.closest('[data-deactivate-form]');
    if (desat) {
      event.preventDefault();
      if (!desat.reportValidity()) return;
      const d = new FormData(desat);
      try {
        const r = await managerService.desativarArena(
          String(d.get('motivo')).trim(),
          String(d.get('periodo'))
        );
        root.querySelector('[data-deactivate-dialog]').hidden = true;
        /* O NUMERO DE CANCELADAS aparece no aviso. O servidor ja devolvia e a
           tela ia descartar: sao pessoas que perderam o horario, e o dono tem
           de saber quantas para poder avisa-las. */
        const n = r?.canceladas || 0;
        window.pqToast?.(n
          ? `Arena desativada · ${n} ${n === 1 ? 'reserva cancelada' : 'reservas canceladas'}`
          : 'Arena desativada');
      } catch (error) {
        window.pqToast?.(error.message || 'Não foi possível desativar');
      }
      return;
    }

    const cupom = event.target.closest('[data-coupon-form]');
    if (cupom) {
      event.preventDefault();
      if (!cupom.reportValidity()) return;
      const d = new FormData(cupom);

      if (API_BASE_URL) {
        try {
          await managerService.criarCupom({
            codigo: String(d.get('code')).trim().toUpperCase(),
            descontoPercent: Number(d.get('discount')),
            expiraEm: String(d.get('expires'))
          });
        } catch (error) {
          window.pqToast?.(error.message || 'Não foi possível criar');
          return;
        }
        root.querySelector('[data-coupon-dialog]').hidden = true;
        cupom.reset();
        await renderCupons(root);
        window.pqToast?.('Cupom criado');
        return;
      }

      storage.set(COUPONS_KEY, [...coupons(), {
        id: `cupom-${Date.now()}`,
        code: String(d.get('code')).trim().toUpperCase(),
        discount: Number(d.get('discount')),
        expires: String(d.get('expires')),
        court: String(d.get('court'))
      }]);
      root.querySelector('[data-coupon-dialog]').hidden = true;
      cupom.reset();
      await renderCupons(root);
      window.pqToast?.('Cupom criado');
    }
  });
}


/* Nova reserva vinda de um clique na agenda: dia e hora ja preenchidos.

   `#reserva-nova?dia=2026-08-26&hora=20:00`. Sem isto o gesto de clicar no
   buraco da agenda levaria a um formulario em branco, e o dono teria de
   redigitar exatamente o que estava vendo na tela um segundo antes — que e o
   tipo de atrito que faz a pessoa desistir de usar a tela e anotar no caderno.
*/
export function prefillReservaNova(root) {
  const q = location.hash.split('?')[1];
  if (!q) return;
  const params = new URLSearchParams(q);
  const dia = params.get('dia');
  const hora = params.get('hora');

  if (dia) {
    const campo = root.querySelector('[name="data"]');
    if (campo) {
      // O campo e texto livre ("Hoje", "24/08"): a data vai no formato que a
      // pessoa reconhece, e nao em ISO.
      const [a, m, d] = dia.split('-');
      campo.value = `${d}/${m}/${a}`;
    }
  }
  if (hora) {
    const sel = root.querySelector('[name="inicio"]');
    if (sel) {
      // O select e montado depois; se a opcao ainda nao existe, cria.
      if (!Array.from(sel.options).some((o) => o.value === hora)) {
        sel.insertAdjacentHTML('beforeend', `<option value="${hora}">${hora}</option>`);
      }
      sel.value = hora;
    }
  }
}


/* ═══════════════════ Galeria de fotos da quadra ═══════════════════════════

   O campo aceitava UMA foto e a vitrine exige cinco. Aqui a regra deixa de ser
   um texto que ninguem le e vira estado da tela: contador, barra e o botao de
   salvar travado ate completar.

   Travar ANTES e nao depois: recusar no envio, com a tela toda preenchida, e o
   pior momento possivel para dar a noticia — a pessoa ja gastou o esforco e
   descobre que precisa sair para buscar imagem.
*/
const MIN_FOTOS = 5;

/* As fotos vivem aqui e nao no DOM: o preview e um data URL grande, e guardar
   em atributo faria o HTML da pagina crescer alguns megabytes. */
let fotosDaQuadra = [];

function pintarGaleria(root) {
  const grade = root.querySelector('[data-galeria-grade]');
  if (!grade) return;

  grade.innerHTML = fotosDaQuadra.map((src, i) => `
    <figure class="galeria__item${i === 0 ? ' capa' : ''}">
      <img src="${src}" alt="Foto ${i + 1} da quadra">
      ${i === 0 ? '<figcaption>Capa</figcaption>' : ''}
      <button type="button" class="galeria__x" data-galeria-remove="${i}" aria-label="Remover foto ${i + 1}">
        <i class="ic sm" data-lucide="trash-2"></i>
      </button>
    </figure>`).join('')
    // Os espacos que faltam aparecem VAZIOS, e nao ausentes: cinco caixas
    // desde o inicio mostram o tamanho da tarefa.
    + Array.from({ length: Math.max(0, MIN_FOTOS - fotosDaQuadra.length) }, () =>
      '<div class="galeria__vaga"><i class="ic" data-lucide="image"></i></div>').join('');

  const conta = root.querySelector('[data-galeria-conta]');
  const faltam = MIN_FOTOS - fotosDaQuadra.length;
  if (conta) {
    conta.textContent = faltam > 0
      ? `${fotosDaQuadra.length} de ${MIN_FOTOS} — faltam ${faltam} para publicar`
      : `${fotosDaQuadra.length} fotos · pronta para a vitrine`;
    conta.classList.toggle('ok', faltam <= 0);
  }

  const barra = root.querySelector('[data-galeria-progresso]');
  if (barra) {
    barra.style.width = `${Math.min(100, (fotosDaQuadra.length / MIN_FOTOS) * 100)}%`;
    barra.classList.toggle('ok', faltam <= 0);
  }

  /* O botao de salvar segue o estado. `title` e nao so `disabled`: botao
     desabilitado sem explicacao faz a pessoa clicar de novo achando que a tela
     travou. */
  const salvar = root.querySelector('[type="submit"]');
  if (salvar) {
    salvar.disabled = faltam > 0;
    salvar.title = faltam > 0 ? `Faltam ${faltam} fotos para publicar a quadra` : '';
  }
  window.pqRefreshIcons?.(root);
}

export function initGaleriaQuadra() {
  document.addEventListener('change', async (event) => {
    const input = event.target.closest('[data-galeria-input]');
    if (!input) return;
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root) return;

    const arquivos = Array.from(input.files || []);
    for (const arquivo of arquivos) {
      if (!String(arquivo.type).startsWith('image/')) continue;
      if (arquivo.size > 10 * 1024 * 1024) {
        window.pqToast?.('Cada foto precisa ter até 10 MB');
        continue;
      }
      try {
        fotosDaQuadra.push(await reduzirImagem(arquivo));
      } catch (error) {
        window.pqToast?.('Não foi possível ler uma das imagens');
      }
    }
    input.value = '';
    pintarGaleria(root);
  });

  document.addEventListener('click', (event) => {
    const x = event.target.closest('[data-galeria-remove]');
    if (!x) return;
    const root = document.querySelector('[data-desktop-route-view]');
    fotosDaQuadra.splice(Number(x.dataset.galeriaRemove), 1);
    pintarGaleria(root);
  });
}

/* Reduz antes de enviar: foto de celular tem 4 MB, e cinco delas em data URL
   passariam do limite do corpo da requisicao. 1280px basta para a vitrine. */
function reduzirImagem(arquivo, maxLado = 1280, qualidade = 0.82) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error('falha ao ler'));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('falha ao abrir'));
      img.onload = () => {
        const escala = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * escala);
        c.height = Math.round(img.naturalHeight * escala);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', qualidade));
      };
      img.src = String(leitor.result);
    };
    leitor.readAsDataURL(arquivo);
  });
}

export function fotosDoFormulario() {
  return fotosDaQuadra.slice();
}

export function definirFotos(lista, root) {
  fotosDaQuadra = Array.isArray(lista) ? lista.slice() : [];
  if (root) pintarGaleria(root);
}
