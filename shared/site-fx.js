/**
 * SPBC atmosphere + subtle 3D polish
 * - Fixed WebGL particle field (three.js CDN, optional)
 * - CSS 3D tilt on cards (no lib)
 * Respects prefers-reduced-motion + visibility pause
 */
(function () {
  var reduced =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Card tilt (CSS 3D) ────────────────────────────────────
  function initTilt() {
    if (reduced) return;
    if (window.matchMedia('(hover: none)').matches) return; // touch: skip

    var max = 7; // degrees
    document.querySelectorAll(
      '.price-card, .pillar-card, .result-card, .tilt-3d'
    ).forEach(function (el) {
      if (el.dataset.tiltBound) return;
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

  // Re-bind when price list is injected
  var mo;
  function watchProducts() {
    var root = document.getElementById('priceTable');
    if (!root || typeof MutationObserver === 'undefined') return;
    mo = new MutationObserver(function () {
      initTilt();
    });
    mo.observe(root, { childList: true });
  }

  // ── Three.js particle field ───────────────────────────────
  function initParticles() {
    if (reduced) return;
    if (typeof THREE === 'undefined') return;
    // Skip tiny screens / save data
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
    var camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.z = 18;

    var count = window.innerWidth < 768 ? 80 : 140;
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

    var mat = new THREE.PointsMaterial({
      size: 0.08,
      color: 0xfdd700,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      sizeAttenuation: true,
    });
    var points = new THREE.Points(geo, mat);
    scene.add(points);

    // Soft green ambient points layer
    var positions2 = new Float32Array(count * 3);
    for (var j = 0; j < count; j++) {
      positions2[j * 3] = (Math.random() - 0.5) * 40;
      positions2[j * 3 + 1] = (Math.random() - 0.5) * 28;
      positions2[j * 3 + 2] = (Math.random() - 0.5) * 22;
    }
    var geo2 = new THREE.BufferGeometry();
    geo2.setAttribute('position', new THREE.BufferAttribute(positions2, 3));
    var mat2 = new THREE.PointsMaterial({
      size: 0.12,
      color: 0x22c55e,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    var points2 = new THREE.Points(geo2, mat2);
    scene.add(points2);

    var running = true;
    var raf = 0;
    var t0 = performance.now();

    function onResize() {
      var w = window.innerWidth;
      var h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }
    window.addEventListener('resize', onResize, { passive: true });

    document.addEventListener('visibilitychange', function () {
      running = document.visibilityState === 'visible';
      if (running) loop();
    });

    function loop() {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      var t = (performance.now() - t0) * 0.001;
      points.rotation.y = t * 0.04;
      points.rotation.x = Math.sin(t * 0.15) * 0.08;
      points2.rotation.y = -t * 0.025;
      points2.rotation.x = Math.cos(t * 0.12) * 0.06;
      // slow drift
      var pos = geo.attributes.position.array;
      for (var k = 0; k < count; k++) {
        pos[k * 3 + 1] += Math.sin(t * speeds[k] + k) * 0.002;
      }
      geo.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
    }
    loop();
  }

  function boot() {
    document.body.classList.add('atmosphere');
    initTilt();
    watchProducts();
    // three.js may load after us (defer) — wait briefly
    if (typeof THREE !== 'undefined') {
      initParticles();
    } else {
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        if (typeof THREE !== 'undefined') {
          clearInterval(iv);
          initParticles();
        } else if (tries > 40) {
          clearInterval(iv);
        }
      }, 50);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // After async product render
  window.spbcAtmosphereRefresh = function () {
    initTilt();
  };
})();
