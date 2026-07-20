/**
 * SPBC layered-depth atmosphere
 * - WebGL particles (three.js optional CDN)
 * - CSS 3D tilt on .price-card / .pillar-card only (max 6°)
 * - Scroll reveal, hero parallax, magnetic CTA, cart pulse helper
 */
(function () {
  var reduced =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer =
    window.matchMedia &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // ── Tilt (price + pillar only, max 6°) ────────────────────
  function initTilt() {
    if (reduced || !finePointer) return;
    var max = 6;
    document.querySelectorAll('.price-card, .pillar-card').forEach(function (el) {
      if (el.dataset.tiltBound) return;
      // Never tilt forms
      if (el.closest('#orderForm, #coachForm, .flat-panel, .modal-sheet')) return;
      el.dataset.tiltBound = '1';
      el.classList.add('tilt-3d');
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        el.classList.add('is-tilting');
        el.style.transform =
          'rotateY(' + (px * max * 2).toFixed(2) + 'deg) rotateX(' + (-py * max * 2).toFixed(2) + 'deg) translateZ(0)';
      });
      el.addEventListener('pointerleave', function () {
        el.classList.remove('is-tilting');
        el.style.transform = '';
      });
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

  // ── Scroll reveal ─────────────────────────────────────────
  function initReveal() {
    var els = document.querySelectorAll('.reveal:not(.is-visible):not([data-reveal-bound])');
    if (!els.length) return;
    if (reduced) {
      els.forEach(function (el) { el.classList.add('is-visible'); });
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
    els.forEach(function (el, i) {
      el.dataset.revealBound = '1';
      // Stagger siblings in same parent up to 5
      var parent = el.parentElement;
      if (parent) {
        var sibs = parent.querySelectorAll(':scope > .reveal');
        var idx = Array.prototype.indexOf.call(sibs, el);
        if (idx >= 0 && idx < 5) el.dataset.revealDelay = String(idx * 60);
      }
      io.observe(el);
    });
  }

  // ── Hero parallax (desktop) ───────────────────────────────
  function initHeroParallax() {
    if (reduced) return;
    if (window.innerWidth < 768) return;
    var orbs = document.querySelectorAll('.page-hero-orb');
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

  // ── Magnetic primary CTAs ─────────────────────────────────
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

  // ── Particles ─────────────────────────────────────────────
  function initParticles() {
    if (reduced) return;
    if (typeof THREE === 'undefined') return;
    if (window.innerWidth < 380) return;
    if (navigator.connection && navigator.connection.saveData) return;

    var canvas = document.getElementById('atmosphere-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'atmosphere-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(canvas, document.body.firstChild);
    }

    var renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'low-power',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight, false);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.z = 18;

    var count = window.innerWidth < 768 ? 40 : 80;
    var positions = new Float32Array(count * 3);
    var speeds = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 36;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 24;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
      speeds[i] = 0.15 + Math.random() * 0.35;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.08,
        color: 0xfdd700,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    scene.add(points);

    var positions2 = new Float32Array(count * 3);
    for (var j = 0; j < count; j++) {
      positions2[j * 3] = (Math.random() - 0.5) * 40;
      positions2[j * 3 + 1] = (Math.random() - 0.5) * 28;
      positions2[j * 3 + 2] = (Math.random() - 0.5) * 22;
    }
    var geo2 = new THREE.BufferGeometry();
    geo2.setAttribute('position', new THREE.BufferAttribute(positions2, 3));
    var points2 = new THREE.Points(
      geo2,
      new THREE.PointsMaterial({
        size: 0.11,
        color: 0x22c55e,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      })
    );
    scene.add(points2);

    var running = true;
    var visible = true;
    var t0 = performance.now();

    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
    window.addEventListener('resize', onResize, { passive: true });

    document.addEventListener('visibilitychange', function () {
      running = document.visibilityState === 'visible' && visible;
      if (running) loop();
    });

    if (window.IntersectionObserver) {
      new IntersectionObserver(
        function (entries) {
          visible = entries[0] && entries[0].isIntersecting;
          running = document.visibilityState === 'visible' && visible;
          if (running) loop();
        },
        { threshold: 0.01 }
      ).observe(canvas);
    }

    function loop() {
      if (!running) return;
      requestAnimationFrame(loop);
      var t = (performance.now() - t0) * 0.001;
      points.rotation.y = t * 0.04;
      points.rotation.x = Math.sin(t * 0.15) * 0.08;
      points2.rotation.y = -t * 0.025;
      var pos = geo.attributes.position.array;
      for (var k = 0; k < count; k++) {
        pos[k * 3 + 1] += Math.sin(t * speeds[k] + k) * 0.002;
      }
      geo.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
    }
    loop();
  }

  // Public helper: pulse cart badge
  window.spbcPulseCartBadge = function () {
    if (reduced) return;
    var badge = document.getElementById('cartBadge');
    if (!badge) return;
    badge.classList.remove('pulse');
    void badge.offsetWidth;
    badge.classList.add('pulse');
  };

  // Public helper: animate number text
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

  function boot() {
    document.body.classList.add('atmosphere');
    initTilt();
    watchProducts();
    initReveal();
    initHeroParallax();
    initMagnetic();
    if (typeof THREE !== 'undefined') {
      initParticles();
    } else {
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        if (typeof THREE !== 'undefined') {
          clearInterval(iv);
          initParticles();
        } else if (tries > 40) clearInterval(iv);
      }, 50);
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
