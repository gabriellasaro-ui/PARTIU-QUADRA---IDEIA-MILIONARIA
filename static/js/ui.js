/* Comportamentos de UI compartilhados (mobile + desktop):
   - toast: window.pqToast(msg)
   - [data-toast]:  ação provisória -> mostra toast (trava navegação de href="#")
   - [data-csv-table]: exporta a tabela alvo como CSV (download real)
   - [data-file-trigger]: dispara um <input type=file> (ex.: trocar logo)
   - input[type=file][data-preview]: mostra a imagem escolhida no elemento alvo
   - .switch-row: liga/desliga o switch
   - [data-reply-toggle] / [data-reply-send]: responder avaliação inline
   - [data-toggle-quadra]: pausa/ativa a quadra do card
   - [data-seg]: abas/segmentos (move .on + filtro opcional via data-filter/data-status/data-target) */
(function () {
  function toast(msg) {
    var t = document.getElementById('pq-toast');
    if (!t) return;
    var m = t.querySelector('[data-toast-msg]');
    if (m) m.textContent = msg;
    t.hidden = false;
    clearTimeout(t._pqt);
    t._pqt = setTimeout(function () { t.hidden = true; }, 2600);
  }
  window.pqToast = toast;

  function downloadCsv(table, name) {
    var rows = Array.prototype.slice.call(table.querySelectorAll('tr'));
    var csv = rows.map(function (tr) {
      var cells = Array.prototype.slice.call(tr.querySelectorAll('th,td'));
      return cells.map(function (c) {
        var t = c.textContent.replace(/\s+/g, ' ').trim().replace(/"/g, '""');
        return '"' + t + '"';
      }).join(',');
    }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  document.addEventListener('click', function (e) {
    // 1) ação provisória -> toast
    var act = e.target.closest('[data-toast]');
    if (act) { e.preventDefault(); toast(act.getAttribute('data-toast')); return; }

    // 1b) copiar texto para a área de transferência (real)
    var cp = e.target.closest('[data-copy]');
    if (cp) {
      e.preventDefault();
      var val = cp.getAttribute('data-copy');
      var done = function () { toast(cp.getAttribute('data-copy-msg') || 'Copiado!'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(val).then(done, done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = val; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (err) {}
        document.body.removeChild(ta); done();
      }
      return;
    }

    // 2) exportar CSV (download real)
    var csv = e.target.closest('[data-csv-table]');
    if (csv) {
      e.preventDefault();
      var tbl = document.querySelector(csv.getAttribute('data-csv-table'));
      if (tbl) { downloadCsv(tbl, csv.getAttribute('data-csv-name') || 'export.csv'); toast('CSV exportado'); }
      return;
    }

    // 3) trocar logo -> dispara o seletor de arquivo
    var ft = e.target.closest('[data-file-trigger]');
    if (ft) {
      e.preventDefault();
      var inp = document.querySelector(ft.getAttribute('data-file-trigger'));
      if (inp) inp.click();
      return;
    }

    // chip selecionável (ex.: esportes favoritos no perfil)
    var chip = e.target.closest('[data-chip-toggle]');
    if (chip) { e.preventDefault(); chip.classList.toggle('on'); return; }

    // 4) switch (liga/desliga)
    var row = e.target.closest('.switch-row');
    if (row) {
      var sw = row.querySelector('.switch');
      if (sw) sw.classList.toggle('on');
      return;
    }

    // 5) responder avaliação: abre a caixa
    var rt = e.target.closest('[data-reply-toggle]');
    if (rt) {
      e.preventDefault();
      var box = rt.parentElement.querySelector('[data-reply-box]');
      if (box) { box.hidden = !box.hidden; if (!box.hidden) { var ta = box.querySelector('textarea'); if (ta) ta.focus(); } }
      return;
    }
    // 6) enviar a resposta
    var rs = e.target.closest('[data-reply-send]');
    if (rs) {
      e.preventDefault();
      var wrap = rs.closest('[data-reply-box]');
      var area = wrap.querySelector('textarea');
      var txt = (area.value || '').trim();
      if (!txt) { toast('Escreva uma resposta primeiro'); return; }
      var out = document.createElement('div');
      out.className = 'review-answer';
      out.innerHTML = '<strong>Resposta do dono:</strong> ';
      out.appendChild(document.createTextNode(txt));
      wrap.parentElement.insertBefore(out, wrap);
      wrap.hidden = true; area.value = '';
      toast('Resposta enviada');
      return;
    }

    // 7) remover um item (ex.: tirar dos favoritos)
    var rm = e.target.closest('[data-remove]');
    if (rm) {
      e.preventDefault();
      var el = rm.closest(rm.getAttribute('data-remove'));
      if (el) el.remove();
      toast(rm.getAttribute('data-remove-msg') || 'Removido');
      return;
    }

    // 8) pausar / ativar quadra
    var tg = e.target.closest('[data-toggle-quadra]');
    if (tg) {
      e.preventDefault();
      var card = tg.closest('.qcard');
      var badge = card && card.querySelector('.pill.status');
      if (badge) {
        var ativa = badge.classList.contains('pago');
        badge.classList.toggle('pago', !ativa);
        badge.classList.toggle('pendente', ativa);
        badge.textContent = ativa ? 'Pausada' : 'Ativa';
        tg.textContent = ativa ? 'Ativar' : 'Pausar';
        toast(ativa ? 'Quadra pausada' : 'Quadra ativada');
      }
      return;
    }

    // 8) abas / segmentos (move .on + filtro opcional)
    var seg = e.target.closest('[data-seg]');
    if (seg) {
      var item = e.target.closest('[data-seg] > a, [data-seg] > button');
      if (!item) return;
      if (item.tagName === 'BUTTON' || item.getAttribute('href') === '#') e.preventDefault();
      Array.prototype.forEach.call(seg.children, function (c) { c.classList && c.classList.remove('on'); });
      item.classList.add('on');

      var filter = item.getAttribute('data-filter');
      if (filter !== null) {
        var target = seg.getAttribute('data-target');
        var group = target ? document.querySelector(target) : null;
        if (group) {
          var shown = 0;
          group.querySelectorAll('[data-status]').forEach(function (r) {
            var ok = (filter === '' || r.getAttribute('data-status') === filter);
            r.style.display = ok ? '' : 'none';
            if (ok) shown++;
          });
          var empty = group.querySelector('[data-empty]');
          if (empty) empty.hidden = shown > 0;
        }
      }
      return;
    }
  });

  // preview de imagem ao trocar o logo
  document.addEventListener('change', function (e) {
    var inp = e.target;
    if (!inp || !inp.matches || !inp.matches('input[type=file][data-preview]')) return;
    var f = inp.files && inp.files[0];
    if (!f) return;
    var target = document.querySelector(inp.getAttribute('data-preview'));
    var reader = new FileReader();
    reader.onload = function () {
      if (!target) return;
      target.style.backgroundImage = 'url(' + reader.result + ')';
      target.style.backgroundSize = 'cover';
      target.style.backgroundPosition = 'center';
      target.textContent = '';
    };
    reader.readAsDataURL(f);
    toast('Logo atualizado');
  });
})();
