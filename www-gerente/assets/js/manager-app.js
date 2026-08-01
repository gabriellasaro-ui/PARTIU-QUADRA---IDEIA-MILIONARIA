/* TODO: substituir persistência local por services/api.js quando os endpoints FastAPI estiverem disponíveis. */
(function () {
  if (!document.documentElement.hasAttribute('data-manager-app')) return;

  var MEMBER_KEY = 'pq-manager-members';
  var COUPON_KEY = 'pq-manager-coupons';

  function toast(message) {
    if (typeof window.pqToast === 'function') window.pqToast(message);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function load(key) {
    try {
      var value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (error) {
      return [];
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // O app continua funcional mesmo sem armazenamento local.
    }
  }

  function formatMoney(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  }

  function closeModal(element) {
    var modal = element && element.closest('.modal');
    if (modal) modal.hidden = true;
  }

  function findByDataId(root, attribute, id) {
    return Array.prototype.find.call(root.querySelectorAll('[' + attribute + ']'), function (element) {
      return element.getAttribute(attribute) === id;
    }) || null;
  }

  var notificationButton = document.querySelector('[data-manager-notifications]');
  var notificationMenu = document.querySelector('[data-manager-notification-menu]');

  function setNotifications(open) {
    if (!notificationButton || !notificationMenu) return;
    notificationMenu.hidden = !open;
    notificationButton.setAttribute('aria-expanded', String(open));
  }

  if (notificationButton && notificationMenu) {
    notificationButton.addEventListener('click', function (event) {
      event.stopPropagation();
      setNotifications(notificationMenu.hidden);
    });

    notificationMenu.addEventListener('click', function (event) {
      event.stopPropagation();
    });

    document.addEventListener('click', function () {
      setNotifications(false);
    });

    document.querySelectorAll('[data-manager-notifications-close]').forEach(function (button) {
      button.addEventListener('click', function () {
        setNotifications(false);
      });
    });
  }

  document.querySelectorAll('[data-manager-setting]').forEach(function (button) {
    var setting = button.getAttribute('data-manager-setting');
    var stored = null;
    try {
      stored = localStorage.getItem('pq-manager-' + setting);
    } catch (error) {
      stored = null;
    }

    if (stored !== null) {
      var enabled = stored === 'true';
      button.classList.toggle('is-on', enabled);
      button.setAttribute('aria-pressed', String(enabled));
    }

    button.addEventListener('click', function () {
      var enabled = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(enabled));
      button.classList.toggle('is-on', enabled);
      try {
        localStorage.setItem('pq-manager-' + setting, String(enabled));
      } catch (error) {
        // Sem persistência, o estado ainda funciona nesta sessão.
      }
      toast(enabled ? 'Configuração ativada' : 'Configuração desativada');
    });
  });

  var memberList = document.querySelector('[data-manager-member-list]');
  var memberForm = document.querySelector('[data-manager-member-form]');

  function memberMarkup(member) {
    var initial = String(member.name || '?').trim().charAt(0).toUpperCase() || '?';
    return '' +
      '<span class="manager-avatar">' + escapeHtml(initial) + '</span>' +
      '<div class="manager-member__person"><strong>' + escapeHtml(member.name) + '</strong><small>' + escapeHtml(member.court) + '</small></div>' +
      '<div><span>Recorrência</span><strong>Toda ' + escapeHtml(String(member.day).toLowerCase()) + ' · ' + escapeHtml(member.time) + '</strong></div>' +
      '<div><span>Mensalidade</span><strong class="num">' + escapeHtml(formatMoney(member.price)) + '</strong></div>' +
      '<span class="status pago">Ativo</span>' +
      '<div class="manager-row-actions">' +
        '<button type="button" class="manager-row-menu" data-manager-member-edit aria-label="Editar mensalista"><svg class="ic"><use href="#i-pencil"></use></svg></button>' +
        '<button type="button" class="manager-row-menu is-danger" data-manager-member-remove aria-label="Remover mensalista"><svg class="ic"><use href="#i-x"></use></svg></button>' +
      '</div>';
  }

  function renderMember(member) {
    if (!memberList || !member || !member.id) return;
    var article = document.createElement('article');
    article.className = 'manager-member';
    article.setAttribute('data-member-id', member.id);
    article.setAttribute('data-member-name', member.name);
    article.setAttribute('data-member-court', member.court);
    article.setAttribute('data-member-day', member.day);
    article.setAttribute('data-member-time', member.time);
    article.setAttribute('data-member-price', member.price);
    article.innerHTML = memberMarkup(member);

    var current = findByDataId(memberList, 'data-member-id', member.id);
    if (current) current.replaceWith(article);
    else memberList.appendChild(article);
  }

  if (memberList) {
    load(MEMBER_KEY).forEach(renderMember);
  }

  function openMemberEditor(article) {
    if (!memberForm || !article) return;
    memberForm.dataset.editingId = article.getAttribute('data-member-id') || '';
    memberForm.elements.name.value = article.getAttribute('data-member-name') || '';
    memberForm.elements.court.value = article.getAttribute('data-member-court') || 'Society 1';
    memberForm.elements.day.value = article.getAttribute('data-member-day') || 'Terça';
    memberForm.elements.time.value = article.getAttribute('data-member-time') || '20:00';
    memberForm.elements.price.value = article.getAttribute('data-member-price') || '420';
    var heading = memberForm.querySelector('.modal-head h3');
    if (heading) heading.textContent = 'Editar mensalista';
    var modal = memberForm.closest('.modal');
    if (modal) modal.hidden = false;
  }

  if (memberForm) {
    memberForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var data = new FormData(memberForm);
      var member = {
        id: memberForm.dataset.editingId || 'member-' + Date.now(),
        name: String(data.get('name') || '').trim(),
        court: String(data.get('court') || ''),
        day: String(data.get('day') || ''),
        time: String(data.get('time') || ''),
        price: Number(data.get('price') || 0)
      };
      if (!member.name) return;

      var members = load(MEMBER_KEY);
      var index = members.findIndex(function (item) { return item.id === member.id; });
      if (index >= 0) members[index] = member;
      else members.push(member);
      save(MEMBER_KEY, members);
      renderMember(member);
      closeModal(memberForm);
      memberForm.reset();
      memberForm.dataset.editingId = '';
      var heading = memberForm.querySelector('.modal-head h3');
      if (heading) heading.textContent = 'Novo mensalista';
      toast('Mensalista salvo com sucesso');
    });
  }

  document.addEventListener('click', function (event) {
    var addMember = event.target.closest('[data-open-modal="modal-mensalista"]');
    if (addMember && memberForm) {
      memberForm.reset();
      memberForm.dataset.editingId = '';
      var newHeading = memberForm.querySelector('.modal-head h3');
      if (newHeading) newHeading.textContent = 'Novo mensalista';
    }

    var editMember = event.target.closest('[data-manager-member-edit]');
    if (editMember) {
      event.preventDefault();
      openMemberEditor(editMember.closest('[data-member-id]'));
      return;
    }

    var removeMember = event.target.closest('[data-manager-member-remove]');
    if (removeMember && memberList) {
      event.preventDefault();
      var article = removeMember.closest('[data-member-id]');
      var id = article && article.getAttribute('data-member-id');
      if (!id) return;
      save(MEMBER_KEY, load(MEMBER_KEY).filter(function (member) { return member.id !== id; }));
      article.remove();
      toast('Mensalista removido');
    }
  });

  var couponList = document.querySelector('[data-manager-coupon-list]');
  var couponForm = document.querySelector('[data-manager-coupon-form]');

  function couponDescription(coupon) {
    var expires = coupon.expires ? new Date(coupon.expires + 'T12:00:00') : null;
    var date = expires && !Number.isNaN(expires.getTime())
      ? expires.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      : 'sem prazo';
    return coupon.discount + '% de desconto · válido até ' + date;
  }

  function renderCoupon(coupon) {
    if (!couponList || !coupon || !coupon.id) return;
    var article = document.createElement('article');
    article.className = 'manager-coupon';
    article.setAttribute('data-coupon-id', coupon.id);
    article.innerHTML = '' +
      '<span><svg class="ic"><use href="#i-gift"></use></svg></span>' +
      '<div><strong>' + escapeHtml(coupon.code) + '</strong><small>' + escapeHtml(couponDescription(coupon)) + '</small></div>' +
      '<button type="button" data-manager-coupon-remove aria-label="Remover cupom"><svg class="ic sm"><use href="#i-x"></use></svg></button>';
    couponList.appendChild(article);
  }

  if (couponList) {
    load(COUPON_KEY).forEach(renderCoupon);
  }

  if (couponForm) {
    var couponCode = couponForm.elements.code;
    if (couponCode) {
      couponCode.addEventListener('input', function () {
        couponCode.value = couponCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      });
    }

    couponForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var data = new FormData(couponForm);
      var coupon = {
        id: 'coupon-' + Date.now(),
        code: String(data.get('code') || '').trim().toUpperCase(),
        discount: Number(data.get('discount') || 0),
        expires: String(data.get('expires') || ''),
        court: String(data.get('court') || '')
      };
      if (!coupon.code || !coupon.discount || !coupon.expires) return;
      var coupons = load(COUPON_KEY);
      coupons.push(coupon);
      save(COUPON_KEY, coupons);
      renderCoupon(coupon);
      closeModal(couponForm);
      couponForm.reset();
      toast('Cupom criado com sucesso');
    });
  }

  document.addEventListener('click', function (event) {
    var removeCoupon = event.target.closest('[data-manager-coupon-remove]');
    if (!removeCoupon || !couponList) return;
    event.preventDefault();
    var article = removeCoupon.closest('[data-coupon-id]');
    var id = article && article.getAttribute('data-coupon-id');
    if (!id) return;
    save(COUPON_KEY, load(COUPON_KEY).filter(function (coupon) { return coupon.id !== id; }));
    article.remove();
    toast('Cupom removido');
  });

  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') setNotifications(false);
  });
})();
