/**
 * SPBC unified site header
 * - Marks active nav from body[data-page] (gold filled link — no sliding pill)
 * - Scroll state with hysteresis (no top-of-page thrashing)
 * - window.spbcHeaderRefresh() after age-gate accept / layout changes
 */
(function () {
  var bound = false;
  var active = null;
  var header = null;
  var links = [];
  var isScrolled = false;
  // Hysteresis: different enter/leave thresholds prevent sticky-header
  // height changes from bouncing scrollY across a single threshold.
  var SCROLL_ENTER = 48;
  var SCROLL_LEAVE = 8;

  function resolveActive() {
    var page = (document.body && document.body.dataset.page) || '';
    active = null;
    links.forEach(function (a) {
      if (a.dataset.nav === page) {
        a.classList.add('active');
        a.setAttribute('aria-current', 'page');
        active = a;
      } else {
        a.classList.remove('active');
        a.removeAttribute('aria-current');
      }
    });
  }

  function onScroll() {
    if (!header) return;
    var y = window.scrollY || window.pageYOffset || 0;
    var next = isScrolled;
    if (!isScrolled && y > SCROLL_ENTER) next = true;
    else if (isScrolled && y < SCROLL_LEAVE) next = false;

    if (next === isScrolled) return;
    isScrolled = next;
    header.classList.toggle('is-scrolled', isScrolled);
  }

  function bindOnce() {
    if (bound || !header) return;
    bound = true;
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function init() {
    header = document.querySelector('[data-site-header]');
    if (!header) return;
    links = Array.prototype.slice.call(header.querySelectorAll('.nav-link'));
    resolveActive();
    bindOnce();
    // Seed scrolled state without thrash (use enter threshold only on first paint)
    var y = window.scrollY || window.pageYOffset || 0;
    isScrolled = y > SCROLL_ENTER;
    header.classList.toggle('is-scrolled', isScrolled);
  }

  window.spbcHeaderRefresh = function () {
    init();
  };

  function boot() {
    var fontsReady = document.fonts && document.fonts.ready
      ? document.fonts.ready
      : Promise.resolve();
    fontsReady.then(function () { init(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
