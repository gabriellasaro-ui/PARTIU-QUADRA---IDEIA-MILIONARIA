/* TODO: substituir o fluxo simulado por POST /reservas e eventos da API FastAPI. */
(function () {
  var APPROVAL_WINDOW_MS = 15 * 60 * 1000;
  var MOCK_APPROVAL_DELAY_MS = 5000;
  var METHOD_LABELS = {
    pix: 'Pix',
    card: 'Cartão de crédito'
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function icon(name, extraClass) {
    return '<i class="ic ' + (extraClass || '') + '" data-lucide="' + name + '"></i>';
  }

  function refreshIcons(container) {
    if (typeof window.pqRefreshIcons === 'function') {
      window.pqRefreshIcons(container);
    }
  }

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  }

  function formatDate(value) {
    if (!value) return 'Hoje';
    var parts = String(value).split('-').map(Number);
    var date = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
    if (Number.isNaN(date.getTime())) return 'Hoje';

    var today = new Date();
    var tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    function key(item) {
      return [item.getFullYear(), item.getMonth(), item.getDate()].join('-');
    }

    var short = new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit'
    }).format(date);

    if (key(date) === key(today)) return 'Hoje, ' + short;
    if (key(date) === key(tomorrow)) return 'Amanhã, ' + short;

    var weekday = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short'
    }).format(date).replace('.', '');
    return weekday + ', ' + short;
  }

  function formatCountdown(milliseconds) {
    var totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;
    return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }

  function approvalWaitingVisual() {
    return '' +
      '<div class="approval-live-visual" aria-hidden="true">' +
        '<span class="approval-live-visual__route"></span>' +
        '<span class="approval-live-visual__endpoint approval-live-visual__user">' + icon('user-round') + '</span>' +
        '<span class="approval-live-visual__endpoint approval-live-visual__arena">' + icon('goal') + '</span>' +
        '<span class="approval-live-visual__pulse approval-live-visual__pulse--one"></span>' +
        '<span class="approval-live-visual__pulse approval-live-visual__pulse--two"></span>' +
      '</div>' +
      '<div class="approval-live-caption">' +
        '<span aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<strong>A arena está analisando</strong>' +
      '</div>';
  }

  function displayText(value) {
    var replacements = {
      'Volei': 'Vôlei',
      'Tenis': 'Tênis',
      'Jardim Goiás': 'Jardim Goiás',
      'Alto da Glória': 'Alto da Glória',
      'Goiania': 'Goiânia',
      'Grama sintética': 'Grama sintética',
      'Vestiário': 'Vestiário'
    };
    return replacements[value] || value;
  }

  document.querySelectorAll('[data-booking-date-label]').forEach(function (element) {
    element.textContent = formatDate(element.dataset.bookingDate);
  });

  function initPaymentFlow() {
    var root = document.querySelector('[data-payment-flow]');
    if (!root) return;

    var buttons = Array.prototype.slice.call(root.querySelectorAll('[data-payment-method]'));
    var cta = root.querySelector('[data-payment-cta]');
    var pageQuery = new URLSearchParams(window.location.search);
    var requested = pageQuery.get('metodo') || 'pix';
    var selectedMethod = 'pix';

    function select(methodName) {
      var selected = buttons.find(function (button) {
        return button.dataset.paymentMethod === methodName && !button.disabled;
      }) || buttons.find(function (button) {
        return !button.disabled;
      });
      if (!selected) return;

      selectedMethod = selected.dataset.paymentMethod;
      buttons.forEach(function (button) {
        var active = button === selected;
        button.classList.toggle('on', active);
        button.setAttribute('aria-pressed', String(active));
      });

      if (cta) {
        var target = new URL(cta.href, window.location.href);
        target.searchParams.set('metodo', selectedMethod);
        cta.href = target.pathname + target.search;
        cta.setAttribute('aria-label', 'Enviar solicitação usando ' + METHOD_LABELS[selectedMethod]);
      }
    }

    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        if (!button.disabled) select(button.dataset.paymentMethod);
      });
    });

    if (cta) {
      cta.addEventListener('click', function () {
        var target = new URL(cta.href, window.location.href);
        target.searchParams.set('metodo', selectedMethod);
        target.searchParams.set('deadline', String(Date.now() + APPROVAL_WINDOW_MS));
        if (pageQuery.get('resultado')) {
          target.searchParams.set('resultado', pageQuery.get('resultado'));
        }
        cta.href = target.pathname + target.search;
      });
    }

    select(requested);
  }

  function initApprovalFlow() {
    var root = document.querySelector('[data-approval-page]');
    if (!root) return;

    var content = root.querySelector('[data-approval-content]');
    var layout = root.dataset.approvalLayout || 'mobile';
    var venueName = root.dataset.venueName || 'Arena';
    var venueImage = root.dataset.venueImage || '';
    var venueMeta = displayText(root.dataset.venueMeta || '');
    var dateLabel = formatDate(root.dataset.bookingDate);
    var hour = root.dataset.bookingHour || '';
    var endHour = root.dataset.bookingEnd || '';
    var duration = Number(root.dataset.bookingDuration || 1);
    var subtotal = Number(root.dataset.bookingSubtotal || 0);
    var serviceFee = Number(root.dataset.bookingFee || 0);
    var total = Number(root.dataset.bookingTotal || 0);
    var paymentMethod = root.dataset.paymentMethod || 'Pix';
    var bookingCode = root.dataset.bookingCode || 'PQ-RESERVA';
    var otherTimeUrl = root.dataset.otherTimeUrl || '/quadras';
    var otherVenueUrl = root.dataset.otherVenueUrl || '/quadras';
    var reservationsUrl = root.dataset.reservationsUrl || '/reservas';
    var chatUrl = root.dataset.chatUrl || '';
    var query = new URLSearchParams(window.location.search);
    var requestedDeadline = Number(query.get('deadline'));
    var deadline = Number.isFinite(requestedDeadline) && requestedDeadline > 0
      ? requestedDeadline
      : Date.now() + APPROVAL_WINDOW_MS;
    var forcedResult = query.get('resultado') || 'aceito';
    var settled = false;
    var timerId = null;

    function setPageMeta(title, subtitle) {
      document.title = title + ' - Qadras';
      var pageTitle = document.querySelector('[data-page-title]');
      var pageSub = document.querySelector('[data-page-sub]');
      if (pageTitle) pageTitle.textContent = title;
      if (pageSub && subtitle) pageSub.textContent = subtitle;
    }

    function flowMarkup(state) {
      var rejected = state === 'declined' || state === 'expired';
      var approvalClass = state === 'accepted' ? 'is-done' : rejected ? 'is-error' : 'is-current';
      var approvalMarker = state === 'accepted'
        ? icon('check', 'sm')
        : rejected
          ? icon('x', 'sm')
          : '3';

      if (layout === 'desktop') {
        return '' +
          '<ol class="desktop-reservation-flow desktop-reservation-flow--confirmation" aria-label="Etapas da reserva">' +
            '<li class="is-done"><span>' + icon('check', 'sm') + '</span><div><strong>Horário</strong><small>' + escapeHtml(dateLabel) + ' - ' + escapeHtml(hour) + '</small></div></li>' +
            '<li class="is-done"><span>' + icon('check', 'sm') + '</span><div><strong>Pagamento</strong><small>' + escapeHtml(paymentMethod) + '</small></div></li>' +
            '<li class="' + approvalClass + '"><span>' + approvalMarker + '</span><div><strong>Aprovação</strong><small>' + (state === 'accepted' ? 'Arena aceitou' : rejected ? 'Não aprovada' : 'Aguardando arena') + '</small></div></li>' +
            '<li class="' + (state === 'accepted' ? 'is-current' : '') + '"><span>4</span><div><strong>Confirmação</strong><small>Horário garantido</small></div></li>' +
          '</ol>';
      }

      return '' +
        '<ol class="booking-flow booking-flow--confirmation" aria-label="Etapas da reserva">' +
          '<li class="is-done"><span>' + icon('check') + '</span><small>Horário</small></li>' +
          '<li class="is-done"><span>' + icon('check') + '</span><small>Pagamento</small></li>' +
          '<li class="' + approvalClass + '"><span>' + approvalMarker + '</span><small>Aprovação</small></li>' +
          '<li class="' + (state === 'accepted' ? 'is-current' : '') + '"><span>4</span><small>Confirmação</small></li>' +
        '</ol>';
    }

    function renderPending(remaining) {
      var progress = Math.max(0, Math.min(100, (remaining / APPROVAL_WINDOW_MS) * 100));
      setPageMeta('Aguardando aprovação', venueName + ' está analisando a solicitação');

      if (layout === 'desktop') {
        content.innerHTML = flowMarkup('pending') +
          '<section class="desktop-approval-view desktop-approval-view--pending">' +
            approvalWaitingVisual() +
            '<span class="confirm__eyebrow">Solicitação enviada</span>' +
            '<h1>Aguardando a arena</h1>' +
            '<p><strong>' + escapeHtml(venueName) + '</strong> tem até 15 minutos para aceitar o horário solicitado.</p>' +
            '<div class="desktop-approval-timer">' +
              '<div><span>Tempo restante</span><strong data-approval-countdown>' + formatCountdown(remaining) + '</strong></div>' +
              '<div class="desktop-approval-progress"><span data-approval-progress style="width:' + progress + '%"></span></div>' +
            '</div>' +
            '<div class="desktop-approval-reservation">' +
              '<img src="' + escapeHtml(venueImage) + '" alt="' + escapeHtml(venueName) + '">' +
              '<div><span>Sua partida</span><strong>' + escapeHtml(dateLabel) + ' · ' + escapeHtml(hour) + ' a ' + escapeHtml(endHour) + '</strong><small>' + duration + 'h · ' + escapeHtml(venueMeta) + '</small></div>' +
              '<b>' + formatCurrency(total) + '</b>' +
            '</div>' +
            '<div class="desktop-approval-note">' + icon('shield-check') +
              '<span><strong>Pagamento protegido</strong><small>A cobrança só será concluída depois que a arena aceitar.</small></span>' +
            '</div>' +
            '<a href="' + escapeHtml(reservationsUrl) + '" class="btn btn-outline btn-lg">Acompanhar em minhas reservas</a>' +
          '</section>';
      } else {
        content.innerHTML = flowMarkup('pending') +
          '<section class="approval-view approval-view--pending">' +
            approvalWaitingVisual() +
            '<span class="approval-eyebrow">Solicitação enviada</span>' +
            '<h1>Aguardando a arena</h1>' +
            '<p><strong>' + escapeHtml(venueName) + '</strong> tem até 15 minutos para aceitar o seu horário.</p>' +
            '<div class="approval-timer">' +
              '<div><span>Tempo restante</span><strong data-approval-countdown>' + formatCountdown(remaining) + '</strong></div>' +
              '<div class="approval-progress" aria-hidden="true"><span data-approval-progress style="width:' + progress + '%"></span></div>' +
            '</div>' +
            '<div class="approval-reservation">' +
              '<img src="' + escapeHtml(venueImage) + '" alt="' + escapeHtml(venueName) + '">' +
              '<div><strong>' + escapeHtml(dateLabel) + '</strong><span>' + escapeHtml(hour) + ' a ' + escapeHtml(endHour) + ' · ' + duration + 'h</span></div>' +
              '<b>' + formatCurrency(total) + '</b>' +
            '</div>' +
            '<div class="approval-payment-note">' + icon('shield-check') +
              '<span><strong>Pagamento protegido</strong><small>A cobrança só será concluída depois que a arena aceitar.</small></span>' +
            '</div>' +
            '<a href="' + escapeHtml(reservationsUrl) + '" class="btn outline block">Acompanhar em minhas reservas</a>' +
          '</section>';
      }
      refreshIcons(content);
    }

    function renderAccepted() {
      if (settled) return;
      settled = true;
      window.clearInterval(timerId);
      setPageMeta('Reserva confirmada', 'Código ' + bookingCode);

      if (layout === 'desktop') {
        content.innerHTML = flowMarkup('accepted') +
          '<div class="confirm">' +
            '<div class="ring">' + icon('check') + '</div>' +
            '<span class="confirm__eyebrow">Arena aprovou sua solicitação</span>' +
            '<h1>Tudo certo, está marcado!</h1>' +
            '<p class="sub">Seu horário está garantido. Agora é só reunir a turma e jogar.</p>' +
            '<div class="ticket">' +
              '<div class="tk-top"><img src="' + escapeHtml(venueImage) + '" alt="' + escapeHtml(venueName) + '"><div><span>Partida confirmada</span><h3>' + escapeHtml(venueName) + '</h3><div class="m">' + escapeHtml(venueMeta) + '</div></div></div>' +
              '<div class="tk-body">' +
                '<div class="row"><span class="k">Data</span><span class="v">' + escapeHtml(dateLabel) + '</span></div>' +
                '<div class="row"><span class="k">Horário</span><span class="v">' + escapeHtml(hour) + ' - ' + escapeHtml(endHour) + ' (' + duration + 'h)</span></div>' +
                '<div class="row"><span class="k">Pagamento</span><span class="v">' + escapeHtml(paymentMethod) + ' - aprovado</span></div>' +
                '<div class="row"><span class="k">Aluguel</span><span class="v">' + formatCurrency(subtotal) + '</span></div>' +
                '<div class="row"><span class="k">Taxa de serviço</span><span class="v">' + formatCurrency(serviceFee) + '</span></div>' +
                '<div class="row"><span class="k">Total pago</span><span class="v">' + formatCurrency(total) + '</span></div>' +
              '</div>' +
              '<button class="desktop-booking-code" type="button" data-copy="' + escapeHtml(bookingCode) + '" data-copy-msg="Código da reserva copiado"><span><small>Código da reserva</small><strong>' + escapeHtml(bookingCode) + '</strong></span>' + icon('copy') + '</button>' +
            '</div>' +
            '<div class="confirm-actions">' +
              '<a href="' + escapeHtml(reservationsUrl) + '" class="btn btn-primary btn-lg">Ver minhas reservas</a>' +
              (chatUrl ? '<a href="' + escapeHtml(chatUrl) + '" class="btn btn-soft btn-lg">' + icon('message-circle', 'sm') + 'Falar com a arena</a>' : '') +
              '<a href="' + escapeHtml(otherVenueUrl) + '" class="btn btn-outline btn-lg">Reservar outra quadra</a>' +
            '</div>' +
          '</div>';
      } else {
        content.innerHTML = flowMarkup('accepted') +
          '<div class="success approval-view approval-view--accepted">' +
            '<div class="ring">' + icon('check') + '</div>' +
            '<span class="success-eyebrow">Arena aprovou sua solicitação</span>' +
            '<h2>Reserva confirmada</h2>' +
            '<p>Seu horário está garantido. Agora é só reunir a turma e jogar.</p>' +
            '<div class="ticket">' +
              '<div class="ticket-venue"><img src="' + escapeHtml(venueImage) + '" alt="' + escapeHtml(venueName) + '"><div><span>Partida confirmada</span><h3>' + escapeHtml(venueName) + '</h3><p>' + escapeHtml(venueMeta) + '</p></div></div>' +
              '<div class="ticket-details">' +
                '<div class="row"><span class="k">Data</span><span class="v">' + escapeHtml(dateLabel) + '</span></div>' +
                '<div class="row"><span class="k">Horário</span><span class="v">' + escapeHtml(hour) + ' a ' + escapeHtml(endHour) + ' (' + duration + 'h)</span></div>' +
                '<div class="row"><span class="k">Pagamento</span><span class="v">' + escapeHtml(paymentMethod) + '</span></div>' +
                '<div class="row"><span class="k">Aluguel</span><span class="v">' + formatCurrency(subtotal) + '</span></div>' +
                '<div class="row"><span class="k">Taxa de serviço</span><span class="v">' + formatCurrency(serviceFee) + '</span></div>' +
                '<div class="row"><span class="k">Total pago</span><span class="v">' + formatCurrency(total) + '</span></div>' +
              '</div>' +
              '<button class="booking-code" type="button" data-copy="' + escapeHtml(bookingCode) + '" data-copy-msg="Código da reserva copiado"><span><small>Código da reserva</small><strong>' + escapeHtml(bookingCode) + '</strong></span>' + icon('copy') + '</button>' +
            '</div>' +
            '<div class="confirmation-actions">' +
              '<a href="' + escapeHtml(reservationsUrl) + '" class="btn block">Ver minhas reservas</a>' +
              (chatUrl ? '<a href="' + escapeHtml(chatUrl) + '" class="btn outline block">' + icon('message-circle') + 'Falar com a arena</a>' : '') +
              '<a href="' + escapeHtml(otherVenueUrl) + '" class="btn outline block">Reservar outra quadra</a>' +
            '</div>' +
          '</div>';
      }
      refreshIcons(content);
    }

    function renderRejected(reason) {
      if (settled) return;
      settled = true;
      window.clearInterval(timerId);
      var expired = reason === 'expired';
      var eyebrow = expired ? 'Tempo de resposta encerrado' : 'Arena não aceitou';
      var heading = expired ? 'A solicitação expirou' : 'O horário não foi confirmado';
      var description = expired
        ? 'A arena não respondeu dentro de 15 minutos.'
        : 'A arena não conseguiu atender esse horário.';
      setPageMeta('Reserva não confirmada', eyebrow);

      if (layout === 'desktop') {
        content.innerHTML = flowMarkup(expired ? 'expired' : 'declined') +
          '<section class="desktop-approval-view desktop-approval-view--rejected">' +
            '<div class="desktop-approval-symbol">' + icon(expired ? 'clock-alert' : 'calendar-x') + '</div>' +
            '<span class="confirm__eyebrow">' + eyebrow + '</span>' +
            '<h1>' + heading + '</h1>' +
            '<p>' + description + ' Nenhuma cobrança foi realizada.</p>' +
            '<div class="desktop-approval-note">' + icon('badge-check') +
              '<span><strong>Seu pagamento está seguro</strong><small>O valor foi liberado automaticamente para você.</small></span>' +
            '</div>' +
            '<div class="desktop-approval-actions">' +
              '<a href="' + escapeHtml(otherTimeUrl) + '" class="btn btn-primary btn-lg">Escolher outro horário</a>' +
              '<a href="' + escapeHtml(otherVenueUrl) + '" class="btn btn-outline btn-lg">Procurar outra quadra</a>' +
            '</div>' +
          '</section>';
      } else {
        content.innerHTML = flowMarkup(expired ? 'expired' : 'declined') +
          '<section class="approval-view approval-view--rejected">' +
            '<div class="approval-symbol">' + icon(expired ? 'clock-alert' : 'calendar-x') + '</div>' +
            '<span class="approval-eyebrow">' + eyebrow + '</span>' +
            '<h1>' + heading + '</h1>' +
            '<p>' + description + ' Nenhuma cobrança foi realizada.</p>' +
            '<div class="approval-payment-note">' + icon('badge-check') +
              '<span><strong>Seu pagamento está seguro</strong><small>O valor foi liberado automaticamente para você.</small></span>' +
            '</div>' +
            '<div class="approval-recovery-actions">' +
              '<a href="' + escapeHtml(otherTimeUrl) + '" class="btn block">Escolher outro horário</a>' +
              '<a href="' + escapeHtml(otherVenueUrl) + '" class="btn outline block">Procurar outra quadra</a>' +
            '</div>' +
          '</section>';
      }
      refreshIcons(content);
    }

    function tick() {
      var remaining = deadline - Date.now();
      var elapsed = APPROVAL_WINDOW_MS - remaining;
      var countdown = content.querySelector('[data-approval-countdown]');
      var progress = content.querySelector('[data-approval-progress]');

      if (countdown) countdown.textContent = formatCountdown(remaining);
      if (progress) {
        progress.style.width = Math.max(0, Math.min(100, (remaining / APPROVAL_WINDOW_MS) * 100)) + '%';
      }

      if (remaining <= 0 || forcedResult === 'expirado') {
        renderRejected('expired');
      } else if (forcedResult === 'recusado' && elapsed >= 2500) {
        renderRejected('declined');
      } else if (forcedResult !== 'pendente' && forcedResult !== 'recusado' && elapsed >= MOCK_APPROVAL_DELAY_MS) {
        renderAccepted();
      }
    }

    renderPending(Math.max(0, deadline - Date.now()));
    timerId = window.setInterval(tick, 1000);
    tick();
  }

  initPaymentFlow();
  initApprovalFlow();
})();
