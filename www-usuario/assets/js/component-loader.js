const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const LEGACY_LUCIDE_ICONS = {
  bell: 'bell',
  calendar: 'calendar-days',
  card: 'credit-card',
  chat: 'message-circle',
  check: 'check',
  clock: 'clock-3',
  collapse: 'panel-left-close',
  flame: 'flame',
  gift: 'gift',
  grid: 'layout-grid',
  heart: 'heart',
  left: 'arrow-left',
  list: 'list',
  logout: 'log-out',
  map: 'map',
  menu: 'menu',
  pin: 'map-pin',
  plus: 'plus',
  search: 'search',
  send: 'send',
  settings: 'settings',
  shield: 'shield-check',
  star: 'star',
  user: 'user-round',
  wallet: 'wallet-cards',
  zap: 'zap'
};

export function normalizeIcons(root = document) {
  root.querySelectorAll('svg use[href^="#"]').forEach((use) => {
    const href = use.getAttribute('href');
    if (href && !use.hasAttributeNS(XLINK_NAMESPACE, 'href')) {
      use.setAttributeNS(XLINK_NAMESPACE, 'xlink:href', href);
    }
  });
}

function upgradeLegacyIcons(root) {
  root.querySelectorAll('svg use[href^="#i-"]').forEach((use) => {
    const svg = use.closest('svg');
    const legacyName = use.getAttribute('href')?.replace('#i-', '');
    const lucideName = LEGACY_LUCIDE_ICONS[legacyName];
    if (!svg || !lucideName) return;

    const replacement = document.createElement('i');
    replacement.className = svg.getAttribute('class') || 'ic';
    replacement.setAttribute('data-lucide', lucideName);
    svg.replaceWith(replacement);
  });
}

export function refreshIcons(root = document) {
  normalizeIcons(root);
  if (!window.lucide?.createIcons || !window.lucide?.icons) return;
  upgradeLegacyIcons(root);

  window.lucide.createIcons({
    icons: window.lucide.icons,
    root,
    attrs: {
      'aria-hidden': 'true',
      'stroke-width': 2
    }
  });
}

export async function loadComponents(root = document) {
  let pending = Array.from(root.querySelectorAll('[data-component]'));

  while (pending.length) {
    await Promise.all(pending.map(async (node) => {
      const path = node.getAttribute('data-component');
      if (!path) return;

      try {
        const response = await fetch(path, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`Nao foi possivel carregar ${path}`);
        const template = document.createElement('template');
        template.innerHTML = (await response.text()).trim();
        node.replaceWith(template.content.cloneNode(true));
      } catch (error) {
        node.setAttribute('data-component-error', path);
      }
    }));

    pending = Array.from(root.querySelectorAll('[data-component]:not([data-component-error])'));
  }

  refreshIcons(root);
}
