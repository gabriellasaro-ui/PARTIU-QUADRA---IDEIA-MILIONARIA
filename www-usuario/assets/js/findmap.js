/* Mapa de busca (Leaflet + tiles CARTO claros).
   Lê #pq-map-data (JSON das quadras) e monta pins com preço.
   Toggle Lista/Mapa via [data-view]. Degrada bem se o Leaflet não carregar. */
(function () {
  function popupHtml(q, base) {
    return '<a class="pq-pop" href="' + base + q.id + '">' +
      '<img src="' + q.foto + '" alt="">' +
      '<div class="pq-pop-bd">' +
      '<strong>' + q.nome + '</strong>' +
      '<span class="pq-pop-meta">' + q.esporte + ' · ' + q.bairro + '</span>' +
      '<span class="pq-pop-foot"><b>R$ ' + q.preco + '</b><small>/hora</small> · ' +
      '<span class="pq-pop-star">&#9733; ' + q.nota + '</span></span>' +
      '</div></a>';
  }

  function buildMap(el) {
    if (el._pqMap || !window.L) return;
    var dataEl = document.getElementById('pq-map-data');
    if (!dataEl) return;
    var quadras = JSON.parse(dataEl.textContent);
    var ulat = parseFloat(el.dataset.userLat);
    var ulng = parseFloat(el.dataset.userLng);
    var base = el.dataset.detailBase || '/quadra/';

    var map = L.map(el, { scrollWheelZoom: false, zoomControl: true }).setView([ulat, ulng], 13);
    // OpenStreetMap direto: a CARTO passou a pedir chave de API.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap', maxZoom: 19
    }).addTo(map);

    var pts = [[ulat, ulng]];
    L.marker([ulat, ulng], {
      icon: L.divIcon({ className: 'pq-you', html: '<span></span>', iconSize: [20, 20] })
    }).addTo(map).bindPopup('Você está aqui');

    quadras.forEach(function (q) {
      if (q.lat == null || q.lng == null) return;
      var m = L.marker([q.lat, q.lng], {
        icon: L.divIcon({
          className: 'pq-pin',
          html: '<span class="pq-pin-in">R$' + q.preco + '</span>',
          iconSize: [54, 30], iconAnchor: [27, 32]
        })
      }).addTo(map);
      m.bindPopup(popupHtml(q, base), { closeButton: false, offset: [0, -26] });
      pts.push([q.lat, q.lng]);
    });

    if (pts.length > 1) map.fitBounds(pts, { padding: [42, 42], maxZoom: 15 });
    el._pqMap = map;
  }

  function init() {
    var el = document.getElementById('pq-map');
    var toggles = Array.prototype.slice.call(document.querySelectorAll('[data-view]'));

    // Sem Leaflet: esconde o toggle de mapa e mantém a lista.
    if (el && !window.L) {
      toggles.forEach(function (t) { if (t.dataset.view === 'map') t.style.display = 'none'; });
      return;
    }

    toggles.forEach(function (t) {
      t.addEventListener('click', function () {
        var view = t.dataset.view;
        toggles.forEach(function (x) { x.classList.toggle('on', x === t); });
        document.querySelectorAll('[data-pane]').forEach(function (p) {
          p.classList.toggle('hidden', p.dataset.pane !== view);
        });
        if (view === 'map' && el) {
          buildMap(el);
          if (el._pqMap) setTimeout(function () { el._pqMap.invalidateSize(); }, 60);
        }
      });
    });
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
