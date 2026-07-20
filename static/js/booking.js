/* Reserva interativa: seleção de horário + duração com total ao vivo.
   Funciona em mobile e desktop (mesmos data-attributes).
   Fallback sem JS: os horários livres continuam sendo links de 1h. */
(function () {
  function money(v) { return 'R$ ' + v.toFixed(2).replace('.', ','); }
  function pad(h) { return (h < 10 ? '0' + h : '' + h) + ':00'; }

  function init() {
    var root = document.querySelector('[data-booking]');
    if (!root) return;

    var price = parseFloat(root.dataset.price);
    var base = root.dataset.base;
    var slots = Array.prototype.slice.call(root.querySelectorAll('[data-slots] .slot'));
    var durBtns = Array.prototype.slice.call(root.querySelectorAll('[data-dur]'));
    var cta = root.querySelector('[data-bk-cta]');
    var state = { hora: null, dur: 1 };

    function hourOf(s) { return parseInt(s.dataset.hora.slice(0, 2), 10); }
    function freeAt(h) {
      return slots.some(function (s) { return hourOf(s) === h && s.classList.contains('free'); });
    }
    function maxDurFrom(h) {
      var d = 0;
      while (freeAt(h + d) && d < 3) d++;
      return d || 1;
    }
    function set(sel, txt) { var e = root.querySelector(sel); if (e) e.textContent = txt; }

    function render() {
      slots.forEach(function (s) { s.classList.remove('sel'); });

      if (state.hora === null) {
        durBtns.forEach(function (b) { b.classList.remove('on'); });
        set('[data-bk-range]', 'Escolha um horário');
        set('[data-bk-hours]', '');
        set('[data-bk-sub]', '—');
        set('[data-bk-total]', '—');
        set('[data-bk-cta-label]', 'Escolha um horário');
        if (cta) { cta.classList.add('is-disabled'); cta.removeAttribute('href'); }
        return;
      }

      var h = state.hora;
      var md = maxDurFrom(h);
      if (state.dur > md) state.dur = md;

      durBtns.forEach(function (b) {
        var d = parseInt(b.dataset.dur, 10);
        var off = d > md;
        b.classList.toggle('off', off);
        b.disabled = off;
        b.classList.toggle('on', !off && d === state.dur);
      });

      for (var i = 0; i < state.dur; i++) {
        var hh = h + i;
        slots.forEach(function (s) { if (hourOf(s) === hh) s.classList.add('sel'); });
      }

      var sub = price * state.dur;
      var total = Math.round(sub * 100) / 100;

      set('[data-bk-range]', pad(h) + ' – ' + pad(h + state.dur));
      set('[data-bk-hours]', '(' + state.dur + 'h)');
      set('[data-bk-sub]', money(sub));
      set('[data-bk-total]', money(total));
      set('[data-bk-cta-label]', 'Reservar · ' + money(total));
      if (cta) {
        cta.classList.remove('is-disabled');
        cta.href = base + '?hora=' + encodeURIComponent(pad(h)) + '&dur=' + state.dur;
      }
    }

    // guarda a disponibilidade original (dia de hoje) como base
    var baseline = slots.map(function (s) { return s.classList.contains('free'); });

    // troca a disponibilidade ao mudar de dia (mock determinístico por dia)
    function applyDay(offset) {
      var n = slots.length;
      slots.forEach(function (s, j) {
        var free = baseline[(j + offset) % n];
        s.classList.toggle('free', free);
        s.classList.toggle('busy', !free);
        s.classList.remove('sel');
      });
      var ff = slots.filter(function (s) { return s.classList.contains('free'); })[0];
      state.hora = ff ? hourOf(ff) : null;
      render();
    }

    // ouve TODOS os slots (a disponibilidade é dinâmica ao trocar de dia)
    slots.forEach(function (s) {
      s.addEventListener('click', function (e) {
        e.preventDefault();
        if (!s.classList.contains('free')) return;
        state.hora = hourOf(s);
        render();
      });
    });

    durBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        state.dur = parseInt(b.dataset.dur, 10);
        render();
      });
    });

    // dias: troca os horários livres/ocupados
    var dayEls = Array.prototype.slice.call(root.querySelectorAll('.day'));
    dayEls.forEach(function (d, i) {
      d.addEventListener('click', function () {
        dayEls.forEach(function (x) { x.classList.remove('on'); });
        d.classList.add('on');
        applyDay(i);
      });
    });

    // pré-seleciona o primeiro horário livre
    var firstFree = slots.filter(function (s) { return s.classList.contains('free'); })[0];
    if (firstFree) state.hora = hourOf(firstFree);
    render();
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
