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
  if (quadras) quadras.innerHTML = (API_BASE_URL ? await loadCourts() : courts()).map((c) => `<option>${escapeHtml(c.label)}</option>`).join('');

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
  const lista = API_BASE_URL ? await loadCourts() : courts();
  const quadra = id ? lista.find((c) => String(c.id) === id) : null;

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

  const comodidades = storage.get(AMENITIES_KEY, null) || AMENITIES;
  const caixa = root.querySelector('[data-court-amenities]');
  if (caixa) {
    caixa.innerHTML = comodidades.map((a, i) =>
      `<label class="switch-row"${i === comodidades.length - 1 ? ' style="border-bottom:none; padding-bottom:0;"' : ''}>
        <span>${escapeHtml(a.label)}</span>
        <span class="switch${a.on ? ' on' : ''}" data-switch="amenity:${escapeHtml(a.id)}" role="switch" tabindex="0" aria-checked="${a.on}"></span>
      </label>`).join('');
  }

  form.elements.id.value = quadra?.id || '';
  form.elements.label.value = quadra?.label || '';
  form.elements.bairro.value = quadra?.bairro || '';
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

// ------------------------------------------------------------------ configurações

async function renderCupons(root) {
  const lista = root.querySelector('[data-coupon-list]');
  if (!lista) return;
  const atuais = API_BASE_URL ? await managerService.cupons() : coupons();
  lista.innerHTML = atuais.length
    ? atuais.map((c) => `<article class="manager-coupon" data-coupon-id="${escapeHtml(c.id)}">
        <span><svg class="ic"><use href="#i-gift"/></svg></span>
        <div><strong>${escapeHtml(c.code)}</strong><small>${c.discount}% de desconto · válido até ${escapeHtml(formatarData(c.expires))}</small></div>
        <button type="button" data-coupon-remove="${escapeHtml(c.id)}" aria-label="Remover cupom ${escapeHtml(c.code)}"><svg class="ic sm"><use href="#i-x"/></svg></button>
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
      notificaResumo: configApi.notificaResumo
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
  const listaQuadras = API_BASE_URL ? await loadCourts() : courts();
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

  await renderCupons(root);
  window.pqRefreshIcons?.(root);
}

// ------------------------------------------------------------------------ eventos

export function initManagerForms() {
  document.addEventListener('click', async (event) => {
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root) return;

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
          const quadras = await loadCourts();
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
          ativa: root.querySelector('[data-switch="active"]')?.classList.contains('on') ?? true
        };
        try {
          if (id) {
            await managerService.atualizarQuadra(id, body);
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
        bairro: String(d.get('bairro')).trim(),
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
            telefone: String(d.get('telefone') ?? ''),
            email: String(d.get('email') ?? ''),
            pixChave: String(d.get('pixChave') ?? '')
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
