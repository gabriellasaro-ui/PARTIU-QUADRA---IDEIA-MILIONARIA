/* Creditos do mapa recolhidos em um botao "i".

   OpenStreetMap (ODbL) e a CARTO exigem o credito visivel, entao remover
   nao esta em jogo. O que da para fazer e o que Google e Apple fazem: virar
   um icone discreto que abre ao toque. O texto continua no DOM o tempo
   todo — recolhido, nunca removido.

   Mexe no prototype do controle, uma vez, e por isso vale para os tres
   mapas (findmap, mobile e player-desktop) sem que nenhum deles precise
   saber que isso existe.

   Carregar DEPOIS de leaflet.js; os dois usam defer, que preserva a ordem. */
(function () {
  var L = window.L;
  if (!L) return;

  /* Tira o "Leaflet |" da frente: esse e cortesia da biblioteca, nao
     exigencia de licenca. O credito de dados (OSM/CARTO) fica. */
  L.Control.Attribution.prototype.options.prefix = false;

  var ABERTO = 'pq-credits-open';

  function fechaTodos(exceto) {
    var abertos = document.querySelectorAll('.' + ABERTO);
    for (var i = 0; i < abertos.length; i++) {
      if (abertos[i] !== exceto) abertos[i].classList.remove(ABERTO);
    }
  }

  /* Delegado no documento porque os mapas nascem depois deste script — e o
     do mobile e destruido e recriado a cada troca de aba, o que deixaria
     qualquer listener preso ao elemento apontando para um no morto. */
  document.addEventListener('click', function (ev) {
    var alvo = ev.target;
    if (!alvo || typeof alvo.closest !== 'function') return;

    var caixa = alvo.closest('.leaflet-control-attribution');
    if (!caixa) {
      fechaTodos(null);
      return;
    }
    /* Clique num link de credito segue para o site do OSM; so o corpo da
       caixa alterna. */
    if (alvo.closest('a')) return;

    fechaTodos(caixa);
    caixa.classList.toggle(ABERTO);
  });
})();
