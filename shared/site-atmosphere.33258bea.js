/**
 * SPBC layered-depth atmosphere
 * - Lightweight 2D canvas particle drift (no three.js)
 * - Scroll reveal via IntersectionObserver
 * - Hero orb parallax, magnetic CTA, cart pulse helper
 * Hard rules: never animate product/stack card opacity; .reveal only hides under html.spbc-anim
 */
(function () {
  var reduced =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer =
    window.matchMedia &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var saveData =
    (navigator.connection && navigator.connection.saveData) || false;

  function initTilt() {
    document.querySelectorAll('.price-card, .tilt-3d').forEach(function (el) {
      el.style.transform = '';
      el.classList.remove('is-tilting');
      if (el.dataset.tiltBound === '1') {
        el.dataset.tiltBound = '0';
      }
    });
  }

  function watchProducts() {
    var root = document.getElementById('priceTable');
    if (!root || !window.MutationObserver) return;
    new MutationObserver(function () {
      initTilt();
      initReveal();
    }).observe(root, { childList: true });
  }

  /** Last-resort: never leave content hidden because an animation did not run. */
  function revealAll(els) {
    (els || document.querySelectorAll('.reveal:not(.is-visible)')).forEach(function (el) {
      el.classList.add('is-visible');
    });
  }

  function initReveal() {
    var els = document.querySelectorAll('.reveal:not(.is-visible):not([data-reveal-bound])');
    if (!els.length) return;
    if (reduced || !window.IntersectionObserver) {
      revealAll(els);
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          var delay = parseInt(el.dataset.revealDelay || '0', 10) || 0;
          setTimeout(function () { el.classList.add('is-visible'); }, delay);
          io.unobserve(el);
        });
      },
      { threshold: 0.15 }
    );
    els.forEach(function (el) {
      el.dataset.revealBound = '1';
      var parent = el.parentElement;
      if (parent) {
        var sibs = parent.querySelectorAll(':scope > .reveal');
        var idx = Array.prototype.indexOf.call(sibs, el);
        if (idx >= 0 && idx < 5) el.dataset.revealDelay = String(idx * 60);
      }
      io.observe(el);
    });
    setTimeout(function () { revealAll(els); }, 1500);
  }

  function initHeroParallax() {
    if (reduced) return;
    if (window.innerWidth < 768) return;
    var orbs = document.querySelectorAll('.page-hero-orb, .page-hero-blobs svg');
    if (!orbs.length) return;
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var y = window.scrollY || 0;
        orbs.forEach(function (orb, i) {
          var factor = i === 0 ? 0.15 : 0.1;
          orb.style.transform = 'translate3d(0,' + (y * factor).toFixed(1) + 'px,0)';
        });
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function initMagnetic() {
    if (reduced || !finePointer) return;
    document.querySelectorAll('.btn-primary, .btn-magnetic').forEach(function (btn) {
      if (btn.dataset.magBound) return;
      btn.dataset.magBound = '1';
      btn.addEventListener('pointermove', function (e) {
        var r = btn.getBoundingClientRect();
        var cx = r.left + r.width / 2;
        var cy = r.top + r.height / 2;
        var dx = e.clientX - cx;
        var dy = e.clientY - cy;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 40) {
          btn.style.transform = '';
          return;
        }
        var t = 1 - dist / 40;
        btn.style.transform =
          'translate(' + (dx * 0.08 * t).toFixed(1) + 'px,' + (dy * 0.08 * t).toFixed(1) + 'px)';
      });
      btn.addEventListener('pointerleave', function () {
        btn.style.transform = '';
      });
    });
  }

  /**
   * Soft green/gold particle drift — pure 2D canvas (~2KB).
   * Skips under reduced-motion, save-data, or very narrow viewports.
   */
  function initParticles() {
    if (reduced || saveData) return;
    if (window.innerWidth < 380) return;

    var canvas = document.getElementById('atmosphere-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'atmosphere-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(canvas, document.body.firstChild);
    }

    var ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var w = 0;
    var h = 0;
    var particles = [];
    var count = window.innerWidth < 768 ? 30 : 60;
    var running = true;
    var visible = true;
    var raf = 0;

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function makeParticle(i) {
      var gold = i % 3 !== 0;
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        r: gold ? 0.6 + Math.random() * 1.1 : 0.9 + Math.random() * 1.4,
        vx: (Math.random() - 0.5) * 0.18,
        vy: -0.05 - Math.random() * 0.22,
        a: gold ? 0.28 + Math.random() * 0.35 : 0.12 + Math.random() * 0.18,
        gold: gold,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.8
      };
    }

    function seed() {
      particles = [];
      for (var i = 0; i < count; i++) particles.push(makeParticle(i));
    }

    function loop() {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      ctx.clearRect(0, 0, w, h);
      var t = performance.now() * 0.001;
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x += p.vx + Math.sin(t * p.speed + p.phase) * 0.12;
        p.y += p.vy;
        if (p.y < -4) {
          p.y = h + 4;
          p.x = Math.random() * w;
        }
        if (p.x < -4) p.x = w + 4;
        if (p.x > w + 4) p.x = -4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.gold
          ? 'rgba(253, 215, 0,' + p.a.toFixed(3) + ')'
          : 'rgba(34, 197, 94,' + p.a.toFixed(3) + ')';
        ctx.fill();
      }
    }

    function start() {
      if (raf) cancelAnimationFrame(raf);
      running = document.visibilityState === 'visible' && visible;
      if (running) loop();
    }

    function stop() {
      running = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }

    resize();
    seed();
    start();

    window.addEventListener('resize', function () {
      var next = window.innerWidth < 768 ? 30 : 60;
      resize();
      if (next !== count) {
        count = next;
        seed();
      }
    }, { passive: true });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && visible) start();
      else stop();
    });

    if (window.IntersectionObserver) {
      new IntersectionObserver(
        function (entries) {
          visible = !!(entries[0] && entries[0].isIntersecting);
          if (visible && document.visibilityState === 'visible') start();
          else stop();
        },
        { threshold: 0.01 }
      ).observe(canvas);
    }
  }

  window.spbcPulseCartBadge = function () {
    if (reduced) return;
    var badge = document.getElementById('cartBadge');
    if (!badge) return;
    badge.classList.remove('pulse');
    void badge.offsetWidth;
    badge.classList.add('pulse');
  };

  window.spbcCountTo = function (el, toValue, duration) {
    if (!el) return;
    if (reduced) {
      el.textContent = typeof toValue === 'number' ? toValue.toFixed(2) : String(toValue);
      return;
    }
    var from = parseFloat(String(el.textContent).replace(/[^0-9.-]/g, '')) || 0;
    var to = typeof toValue === 'number' ? toValue : parseFloat(toValue) || 0;
    var start = performance.now();
    var dur = duration || 500;
    function frame(now) {
      var p = Math.min(1, (now - start) / dur);
      var v = from + (to - from) * p;
      el.textContent = v.toFixed(2);
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  /**
   * Hero ambient video: poster-first, sources ONLY after window.load, and NEVER when
   * reduced-motion / save-data / 2g / slow-2g / viewport < 768.
   */
  function shouldLoadHeroVideo() {
    if (reduced || saveData) return false;
    if (window.innerWidth < 768) return false;
    var conn = navigator.connection;
    if (conn && conn.effectiveType) {
      var et = String(conn.effectiveType).toLowerCase();
      if (et === '2g' || et === 'slow-2g') return false;
    }
    return true;
  }

  function attachHeroVideos() {
    var vids = document.querySelectorAll('video.page-hero-video[data-src-webm], video.page-hero-video[data-src-mp4]');
    if (!vids.length) return;
    if (!shouldLoadHeroVideo()) return;
    vids.forEach(function (vid) {
      if (vid.dataset.videoAttached === '1') return;
      vid.dataset.videoAttached = '1';
      var webm = vid.getAttribute('data-src-webm');
      var mp4 = vid.getAttribute('data-src-mp4');
      if (webm) {
        var s1 = document.createElement('source');
        s1.src = webm;
        s1.type = 'video/webm';
        vid.appendChild(s1);
      }
      if (mp4) {
        var s2 = document.createElement('source');
        s2.src = mp4;
        s2.type = 'video/mp4';
        vid.appendChild(s2);
      }
      vid.muted = true;
      vid.playsInline = true;
      vid.loop = true;
      vid.setAttribute('muted', '');
      vid.setAttribute('playsinline', '');
      var play = vid.play();
      if (play && typeof play.catch === 'function') play.catch(function () { /* autoplay blocked */ });
    });
  }

  function boot() {
    document.body.classList.add('atmosphere');
    if (!reduced && window.IntersectionObserver) {
      document.documentElement.classList.add('spbc-anim');
    }
    initTilt();
    watchProducts();
    initReveal();
    initHeroParallax();
    initMagnetic();
    initParticles();
    // Poster paints immediately; video never competes with LCP
    if (document.readyState === 'complete') {
      attachHeroVideos();
    } else {
      window.addEventListener('load', attachHeroVideos, { once: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.spbcAtmosphereRefresh = function () {
    initTilt();
    initReveal();
    initMagnetic();
  };
})();
