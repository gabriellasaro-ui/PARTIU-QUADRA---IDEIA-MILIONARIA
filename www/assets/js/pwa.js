/* Registro do Service Worker + botão "Instalar app" (Android/Chrome). */
(function () {
  // Em desenvolvimento o Service Worker so atrapalha: ele mistura JS antigo
  // com HTML novo a cada alteracao estrutural, e o resultado aparece como
  // "tela em branco" ou "nao abre nada" — sintoma que nao tem nenhuma relacao
  // com a causa. Em localhost nao registramos, e ainda removemos qualquer
  // registro antigo junto com os caches, para nao deixar ninguem preso.
  var isDev = ['localhost', '127.0.0.1', '::1', '0.0.0.0'].indexOf(location.hostname) !== -1;

  if ('serviceWorker' in navigator) {
    if (isDev) {
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        regs.forEach(function (reg) { reg.unregister(); });
      }).catch(function () {});
      if (window.caches && caches.keys) {
        caches.keys().then(function (keys) {
          keys.forEach(function (k) { caches.delete(k); });
        }).catch(function () {});
      }
    } else {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function () {});
      });
    }
  }

  var deferred = null;
  var banner = document.getElementById('pwa-install');
  var goBtn = document.getElementById('pwa-go');
  var xBtn = document.getElementById('pwa-x');

  function hide() { if (banner) banner.hidden = true; }
  function show() {
    if (!banner) return;
    if (sessionStorage.getItem('pwa-dismiss') === '1') return;
    banner.hidden = false;
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    show();
  });

  if (goBtn) {
    goBtn.addEventListener('click', function () {
      hide();
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.finally(function () { deferred = null; });
    });
  }
  if (xBtn) {
    xBtn.addEventListener('click', function () {
      sessionStorage.setItem('pwa-dismiss', '1');
      hide();
    });
  }

  window.addEventListener('appinstalled', hide);
})();
