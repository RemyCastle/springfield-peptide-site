/* SPBC hero 3D — procedural peptide vial + gold particle drift (THREE r160 UMD).
   Layers behind .page-hero-inner; skips itself entirely on reduced-motion,
   missing WebGL, or missing THREE so the SVG-blob hero remains the fallback. */
(function () {
  'use strict';

  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!window.THREE) return;
  var canvas = document.getElementById('hero3d');
  if (!canvas) return;
  try {
    var probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return;
  } catch (e) { return; }

  var started = false, running = false, rafId = 0;
  var renderer, scene, camera, clock, vialGroup, particles, particleData;
  var mouseX = 0, mouseY = 0, scrollProg = 0;
  var PARTICLE_COUNT = 220;

  function particleTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,235,160,1)');
    grad.addColorStop(0.35, 'rgba(234,179,8,0.7)');
    grad.addColorStop(1, 'rgba(234,179,8,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  function buildVial() {
    var group = new THREE.Group();

    var glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.62, 2.6, 48),
      new THREE.MeshPhysicalMaterial({
        color: 0xdfefe6, metalness: 0, roughness: 0.06,
        transmission: 0.92, thickness: 0.4, ior: 1.45,
        transparent: true, opacity: 0.4
      })
    );
    group.add(glass);

    var liquid = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1.5, 40),
      new THREE.MeshStandardMaterial({
        color: 0x16a34a, emissive: 0x0a5c26, emissiveIntensity: 0.6,
        roughness: 0.3, transparent: true, opacity: 0.85
      })
    );
    liquid.position.y = -0.45;
    group.add(liquid);

    var label = new THREE.Mesh(
      new THREE.CylinderGeometry(0.64, 0.64, 0.85, 48, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x131c16, roughness: 0.6, metalness: 0.1,
        side: THREE.DoubleSide, transparent: true, opacity: 0.92
      })
    );
    label.position.y = 0.15;
    group.add(label);

    var cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.4, 32),
      new THREE.MeshStandardMaterial({ color: 0xeab308, metalness: 0.9, roughness: 0.25 })
    );
    cap.position.y = 1.5;
    group.add(cap);

    var crimp = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.055, 12, 32),
      new THREE.MeshStandardMaterial({ color: 0xc9990a, metalness: 0.95, roughness: 0.3 })
    );
    crimp.rotation.x = Math.PI / 2;
    crimp.position.y = 1.31;
    group.add(crimp);

    return group;
  }

  function buildParticles() {
    var positions = new Float32Array(PARTICLE_COUNT * 3);
    particleData = [];
    for (var i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 9;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 5.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 4 - 0.5;
      particleData.push({ speed: 0.1 + Math.random() * 0.25, sway: Math.random() * Math.PI * 2 });
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      size: 0.07, map: particleTexture(), color: 0xeab308,
      transparent: true, opacity: 0.8, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true
    });
    return new THREE.Points(geo, mat);
  }

  function layoutForWidth() {
    if (!vialGroup) return;
    var narrow = canvas.clientWidth < 768;
    vialGroup.position.x = narrow ? 0 : 1.7;
    var s = narrow ? 0.7 : 1;
    vialGroup.scale.set(s, s, s);
  }

  function buildScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, canvas.clientWidth / Math.max(canvas.clientHeight, 1), 0.1, 50);
    camera.position.set(0, 0.35, 7);

    vialGroup = buildVial();
    scene.add(vialGroup);
    particles = buildParticles();
    scene.add(particles);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    scene.add(new THREE.HemisphereLight(0xf8fff0, 0x0b120e, 0.6));
    var key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 4, 5);
    scene.add(key);
    var rim = new THREE.PointLight(0xeab308, 20, 15, 2);
    rim.position.set(-3, 1, 2.5);
    scene.add(rim);

    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    clock = new THREE.Clock();
    layoutForWidth();
  }

  function tick() {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    var t = clock.getElapsedTime();

    vialGroup.rotation.y = t * 0.35 + scrollProg * Math.PI * 2;
    vialGroup.rotation.z = Math.sin(t * 0.5) * 0.05 + scrollProg * 0.3;
    vialGroup.position.y = Math.sin(t * 0.9) * 0.12 - scrollProg * 1.2;

    var pos = particles.geometry.attributes.position;
    for (var i = 0; i < PARTICLE_COUNT; i++) {
      var d = particleData[i];
      var y = pos.getY(i) + d.speed * 0.006;
      if (y > 2.9) y = -2.9;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(t * 0.4 + d.sway) * 0.0012);
    }
    pos.needsUpdate = true;
    particles.rotation.y = t * 0.02;

    camera.position.x += (mouseX * 0.45 - camera.position.x) * 0.04;
    camera.position.y += (0.35 - mouseY * 0.3 + scrollProg * 0.8 - camera.position.y) * 0.04;
    camera.lookAt(vialGroup.position.x * 0.6, 0, 0);

    renderer.render(scene, camera);
  }

  function start() {
    if (!started) {
      buildScene();
      started = true;
      window.addEventListener('resize', function () {
        if (!renderer) return;
        camera.aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
        camera.updateProjectionMatrix();
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
        layoutForWidth();
      });
      window.addEventListener('mousemove', function (e) {
        mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
        mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
      }, { passive: true });
      if (window.gsap && window.ScrollTrigger) {
        gsap.registerPlugin(ScrollTrigger);
        ScrollTrigger.create({
          trigger: '.page-hero', start: 'top top', end: 'bottom top', scrub: 1,
          onUpdate: function (self) { scrollProg = self.progress; }
        });
      } else {
        window.addEventListener('scroll', function () {
          var h = canvas.getBoundingClientRect().height || 1;
          scrollProg = Math.min(Math.max(-canvas.getBoundingClientRect().top / h, 0), 1);
        }, { passive: true });
      }
    }
    if (!running) { running = true; clock.getDelta(); tick(); }
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      // canvas inside hidden #mainContent never intersects, so this also
      // defers all WebGL work until the club gate is unlocked
      if (entry.isIntersecting && canvas.clientWidth > 0) start(); else stop();
    });
  }, { threshold: 0.05 });
  io.observe(canvas);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else if (canvas.clientWidth > 0 && canvas.getBoundingClientRect().top < window.innerHeight) start();
  });
})();
