/* Registro do Service Worker + botão "Instalar app" (Android/Chrome). */
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
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
