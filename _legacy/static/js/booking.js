/* TODO: substituir disponibilidade local por GET /quadras/{id}/horarios. */
(function () {
  var DAY_MS = 86400000;

  function money(value) {
    return 'R$ ' + Number(value).toFixed(2).replace('.', ',');
  }

  function pad(hour) {
    return String(hour).padStart(2, '0') + ':00';
  }

  function localDateValue(date) {
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return date.getFullYear() + '-' + month + '-' + day;
  }

  function parseLocalDate(value) {
    var parts = String(value).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  }

  function today() {
    return parseLocalDate(localDateValue(new Date()));
  }

  function dateLabel(value) {
    var date = parseLocalDate(value);
    var current = today();
    var tomorrow = new Date(current);
    tomorrow.setDate(tomorrow.getDate() + 1);
    var short = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
    if (localDateValue(date) === localDateValue(current)) return 'Hoje, ' + short;
    if (localDateValue(date) === localDateValue(tomorrow)) return 'Amanhã, ' + short;
    var weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date).replace('.', '');
    return weekday + ', ' + short;
  }

  function monthValue(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
  }

  function monthDate(value) {
    var parts = String(value).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, 1, 12, 0, 0);
  }

  function init() {
    var root = document.querySelector('[data-booking]');
    if (!root) return;

    var price = parseFloat(root.dataset.price);
    var base = root.dataset.base;
    var slots = Array.prototype.slice.call(root.querySelectorAll('[data-slots] .slot'));
    var durationButtons = Array.prototype.slice.call(root.querySelectorAll('[data-dur]'));
    var calendar = root.querySelector('[data-booking-calendar]');
    var cta = root.querySelector('[data-bk-cta]');
    var baseline = slots.map(function (slot) {
      return slot.classList.contains('free');
    });
    var dayAvailability = baseline.slice();
    var state = {
      date: localDateValue(today()),
      calendarMonth: monthValue(today()),
      hour: null,
      duration: 1
    };
    var stages = ['date', 'duration', 'time'];

    function hourOf(slot) {
      return parseInt(slot.dataset.hora.slice(0, 2), 10);
    }

    function isFreeAt(hour) {
      var index = slots.findIndex(function (slot) {
        return hourOf(slot) === hour;
      });
      return index >= 0 && dayAvailability[index];
    }

    function canStartAt(hour) {
      for (var index = 0; index < state.duration; index += 1) {
        if (!isFreeAt(hour + index)) return false;
      }
      return true;
    }

    function set(selector, text) {
      root.querySelectorAll(selector).forEach(function (element) {
        element.textContent = text;
      });
    }

    function setStage(nextStage, focusPanel) {
      var stage = stages.indexOf(nextStage) >= 0 ? nextStage : 'date';
      var currentIndex = stages.indexOf(stage);
      root.dataset.bookingStage = stage;

      root.querySelectorAll('[data-booking-stage-panel]').forEach(function (panel) {
        var active = panel.dataset.bookingStagePanel === stage;
        panel.hidden = !active;
        panel.classList.toggle('is-active', active);
        if (active && focusPanel) {
          panel.tabIndex = -1;
          window.setTimeout(function () { panel.focus({ preventScroll: true }); }, 0);
        }
      });

      root.querySelectorAll('.booking-wizard-nav [data-booking-stage-go]').forEach(function (button) {
        var index = stages.indexOf(button.dataset.bookingStageGo);
        var active = index === currentIndex;
        button.classList.toggle('is-active', active);
        button.classList.toggle('is-complete', index < currentIndex);
        if (active) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
    }

    function renderCalendar() {
      if (!calendar) return;

      var current = today();
      var maxDate = new Date(current);
      maxDate.setDate(maxDate.getDate() + 60);
      var minMonth = new Date(current.getFullYear(), current.getMonth(), 1, 12, 0, 0);
      var maxMonth = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1, 12, 0, 0);
      var month = monthDate(state.calendarMonth);
      if (month < minMonth) month = minMonth;
      if (month > maxMonth) month = maxMonth;
      state.calendarMonth = monthValue(month);

      var formatted = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(month);
      var label = calendar.querySelector('[data-calendar-label]');
      label.textContent = formatted.charAt(0).toUpperCase() + formatted.slice(1);
      calendar.querySelector('[data-calendar-nav="-1"]').disabled = month <= minMonth;
      calendar.querySelector('[data-calendar-nav="1"]').disabled = month >= maxMonth;

      var firstWeekday = month.getDay();
      var totalDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      var cells = [];
      for (var index = 0; index < 42; index += 1) {
        var day = index - firstWeekday + 1;
        if (day < 1 || day > totalDays) {
          cells.push('<span class="calendar-empty" aria-hidden="true"></span>');
          continue;
        }
        var date = new Date(month.getFullYear(), month.getMonth(), day, 12, 0, 0);
        var value = localDateValue(date);
        var disabled = date < current || date > maxDate;
        var selected = value === state.date;
        var isToday = value === localDateValue(current);
        var spoken = new Intl.DateTimeFormat('pt-BR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long'
        }).format(date);
        cells.push(
          '<button type="button" class="calendar-day ' + (selected ? 'on ' : '') + (isToday ? 'is-today' : '') + '"' +
          ' data-calendar-date="' + value + '" aria-label="' + spoken + '" aria-pressed="' + selected + '"' +
          (disabled ? ' disabled' : '') + '><span>' + day + '</span></button>'
        );
      }
      calendar.querySelector('[data-calendar-grid]').innerHTML = cells.join('');
      if (window.pqRefreshIcons) window.pqRefreshIcons(calendar);
      else if (window.lucide) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
    }

    function render() {
      if (state.hour !== null && !canStartAt(state.hour)) state.hour = null;

      var availableStarts = 0;
      slots.forEach(function (slot, index) {
        var hour = hourOf(slot);
        var availableStart = canStartAt(hour);
        var selected = state.hour !== null && hour >= state.hour && hour < state.hour + state.duration;
        if (availableStart) availableStarts += 1;

        slot.classList.toggle('free', availableStart);
        slot.classList.toggle('busy', !availableStart);
        slot.classList.toggle('sel', selected);
        slot.classList.toggle('slot-occupied', !dayAvailability[index]);
        slot.setAttribute('aria-disabled', String(!availableStart));
        slot.setAttribute('aria-pressed', String(state.hour === hour));
        slot.title = availableStart
          ? ''
          : dayAvailability[index]
            ? 'Não há ' + state.duration + 'h consecutivas a partir daqui'
            : 'Horário ocupado';
        if ('disabled' in slot) slot.disabled = !availableStart;
        else slot.tabIndex = availableStart ? 0 : -1;
      });

      durationButtons.forEach(function (button) {
        var duration = parseInt(button.dataset.dur, 10);
        button.disabled = false;
        button.classList.remove('off');
        button.classList.toggle('on', duration === state.duration);
        button.setAttribute('aria-pressed', String(duration === state.duration));
      });

      set('[data-availability-copy]', availableStarts === 1 ? '1 início livre' : availableStarts + ' inícios livres');
      set('[data-duration-help]', state.duration === 1
        ? 'Ideal para um treino rápido. Escolha abaixo o melhor início.'
        : 'Os horários abaixo já garantem ' + state.duration + ' horas consecutivas de quadra.');
      set('[data-bk-date]', dateLabel(state.date));

      if (state.hour === null) {
        set('[data-bk-range]', 'Escolha um horário');
        set('[data-bk-hours]', '');
        set('[data-bk-sub]', '-');
        set('[data-bk-fee]', '-');
        set('[data-bk-total]', '-');
        set('[data-bk-cta-label]', 'Escolha um horário');
        if (cta) {
          cta.classList.add('is-disabled');
          cta.removeAttribute('href');
        }
        return;
      }

      var subtotal = Math.round(price * state.duration * 100) / 100;
      var feeRate = parseFloat(root.dataset.feeRate || '0.05');
      var serviceFee = Math.round(subtotal * feeRate * 100) / 100;
      var total = Math.round((subtotal + serviceFee) * 100) / 100;
      var start = pad(state.hour);
      set('[data-bk-range]', start + ' a ' + pad(state.hour + state.duration));
      set('[data-bk-hours]', '(' + state.duration + 'h)');
      set('[data-bk-sub]', money(subtotal));
      set('[data-bk-fee]', money(serviceFee));
      set('[data-bk-total]', money(total));
      set('[data-bk-cta-label]', 'Continuar - ' + money(total));
      if (cta) {
        var query = new URLSearchParams({
          date: state.date,
          hora: start,
          dur: String(state.duration)
        });
        cta.classList.remove('is-disabled');
        cta.href = base + '?' + query.toString();
      }
    }

    function applyDate(value) {
      var offset = Math.round((parseLocalDate(value) - today()) / DAY_MS);
      dayAvailability = baseline.map(function (_, index) {
        return baseline[(index + offset) % baseline.length];
      });
      state.date = value;
      state.hour = null;
      renderCalendar();
      render();
    }

    if (calendar) {
      calendar.addEventListener('click', function (event) {
        var navigation = event.target.closest('[data-calendar-nav]');
        if (navigation && !navigation.disabled) {
          var month = monthDate(state.calendarMonth);
          month.setMonth(month.getMonth() + parseInt(navigation.dataset.calendarNav, 10));
          state.calendarMonth = monthValue(month);
          renderCalendar();
          return;
        }

        var day = event.target.closest('[data-calendar-date]');
        if (!day || day.disabled) return;
        applyDate(day.dataset.calendarDate);
      });
    }

    slots.forEach(function (slot) {
      slot.setAttribute('role', 'button');
      slot.addEventListener('click', function (event) {
        event.preventDefault();
        if (!canStartAt(hourOf(slot))) return;
        state.hour = hourOf(slot);
        render();
      });
      slot.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        slot.click();
      });
    });

    durationButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        state.duration = parseInt(button.dataset.dur, 10);
        render();
      });
    });

    root.addEventListener('click', function (event) {
      var stageControl = event.target.closest('[data-booking-stage-go]');
      if (!stageControl) return;
      setStage(stageControl.dataset.bookingStageGo, true);
    });

    document.querySelectorAll('[data-gallery-image]').forEach(function (button) {
      button.addEventListener('click', function () {
        var hero = document.querySelector('[data-venue-hero-image]');
        if (!hero) return;
        if (button.hasAttribute('data-gallery-swap')) {
          var previous = hero.src;
          hero.src = button.dataset.galleryImage;
          button.dataset.galleryImage = previous;
          var thumbnail = button.querySelector('img');
          if (thumbnail) thumbnail.src = previous;
          return;
        }
        hero.src = button.dataset.galleryImage;
        document.querySelectorAll('[data-gallery-image]').forEach(function (item) {
          item.classList.toggle('on', item === button);
        });
        var mobilePhotos = Array.prototype.slice.call(document.querySelectorAll('.venue-hero-dot[data-gallery-image]'));
        var current = document.querySelector('[data-venue-photo-current]');
        if (current && mobilePhotos.length) {
          current.textContent = String(mobilePhotos.indexOf(button) + 1);
        }
      });
    });

    document.querySelectorAll('[data-gallery-step]').forEach(function (control) {
      control.addEventListener('click', function () {
        var photos = Array.prototype.slice.call(document.querySelectorAll('.venue-hero-dot[data-gallery-image]'));
        if (!photos.length) return;
        var currentIndex = photos.findIndex(function (button) {
          return button.classList.contains('on');
        });
        var nextIndex = (Math.max(0, currentIndex) + parseInt(control.dataset.galleryStep, 10) + photos.length) % photos.length;
        photos[nextIndex].click();
      });
    });

    applyDate(state.date);
    setStage(root.dataset.bookingStage || 'date', false);
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
