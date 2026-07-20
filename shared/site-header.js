/**
 * SPBC unified site header
 * - Marks active nav from body[data-page]
 * - Sliding gold pill under active link
 * - Scroll state with hysteresis (no top-of-page thrashing)
 * - window.spbcHeaderRefresh() after password unlock / layout changes
 */
(function () {
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var bound = false;
  var active = null;
  var pill = null;
  var header = null;
  var links = [];
  var isScrolled = false;
  // Hysteresis: different enter/leave thresholds prevent sticky-header
  // height changes from bouncing scrollY across a single threshold.
  var SCROLL_ENTER = 48;
  var SCROLL_LEAVE = 8;
  var pillRaf = 0;

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

  function movePill(animateGlow) {
    if (!pill || !active) return;
    // Hidden (password gate) → zero width; skip until visible
    if (active.offsetParent === null && active.getClientRects().length === 0) return;
    var parent = active.parentElement;
    if (!parent) return;
    var r = active.getBoundingClientRect();
    var nr = parent.getBoundingClientRect();
    if (r.width < 2) return;
    var x = r.left - nr.left;
    pill.style.width = Math.round(r.width) + 'px';
    pill.style.transform = 'translateX(' + Math.round(x) + 'px)';
    pill.classList.add('is-ready');
    if (animateGlow && !reduced) {
      pill.classList.remove('just-moved');
      void pill.offsetWidth;
      pill.classList.add('just-moved');
    }
  }

  function schedulePill() {
    if (pillRaf) return;
    pillRaf = requestAnimationFrame(function () {
      pillRaf = 0;
      movePill(false);
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
    // Remeasure pill after layout settles (height change)
    schedulePill();
    // Second pass after CSS transition (~220ms)
    setTimeout(schedulePill, 240);
  }

  function bindOnce() {
    if (bound || !header) return;
    bound = true;
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { movePill(false); }, 80);
    });
    window.addEventListener('scroll', onScroll, { passive: true });

    if (!reduced && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      links.forEach(function (a) {
        a.addEventListener('mouseenter', function () {
          var prev = active;
          active = a;
          movePill(false);
          active = prev || header.querySelector('.nav-link.active');
        });
      });
      var nav = header.querySelector('.site-header__nav');
      if (nav) {
        nav.addEventListener('mouseleave', function () {
          active = header.querySelector('.nav-link.active');
          movePill(false);
        });
      }
    }
  }

  function init(animateGlow) {
    header = document.querySelector('[data-site-header]');
    if (!header) return;
    links = Array.prototype.slice.call(header.querySelectorAll('.nav-link'));
    pill = header.querySelector('.nav-pill');
    resolveActive();
    bindOnce();
    // Seed scrolled state without thrash (use enter threshold only on first paint)
    var y = window.scrollY || window.pageYOffset || 0;
    isScrolled = y > SCROLL_ENTER;
    header.classList.toggle('is-scrolled', isScrolled);
    movePill(!!animateGlow);
    requestAnimationFrame(function () { movePill(false); });
  }

  window.spbcHeaderRefresh = function () {
    init(true);
  };

  function boot() {
    var fontsReady = document.fonts && document.fonts.ready
      ? document.fonts.ready
      : Promise.resolve();
    fontsReady.then(function () { init(true); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
