/**
 * SPBC 21+ / research-use age gate.
 * First visit: blocking overlay. After accept: localStorage spbc_age_ok + spbc_member cookie.
 * Cookie is required for /api/products (soft member session). Do not remove API member check.
 */
(function () {
  var STORAGE_KEY = 'spbc_age_ok';
  var MEMBER_COOKIE = 'spbc_member=1; path=/; max-age=31536000; SameSite=Lax';
  var GATE_ID = 'ageGate';

  function setMemberCookie() {
    document.cookie = MEMBER_COOKIE;
  }

  function isAgeOk() {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function lockScroll(lock) {
    if (lock) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    } else {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
  }

  function getFocusable(root) {
    return Array.prototype.slice.call(
      root.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      )
    ).filter(function (el) {
      return el.offsetParent !== null || el === document.activeElement;
    });
  }

  function trapFocus(e, root) {
    if (e.key !== 'Tab') return;
    var list = getFocusable(root);
    if (!list.length) {
      e.preventDefault();
      return;
    }
    var first = list[0];
    var last = list[list.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first || !root.contains(document.activeElement)) {
        e.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function accept(gate) {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch (e) { /* private mode */ }
    setMemberCookie();
    lockScroll(false);
    if (gate && gate.parentNode) gate.parentNode.removeChild(gate);
    document.removeEventListener('keydown', onKeydown, true);
    window.dispatchEvent(new CustomEvent('spbc:age-ok'));
  }

  var activeGate = null;

  function onKeydown(e) {
    if (!activeGate) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    trapFocus(e, activeGate);
  }

  function showGate() {
    if (document.getElementById(GATE_ID)) return;

    var gate = document.createElement('div');
    gate.id = GATE_ID;
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-labelledby', 'ageGateTitle');
    gate.setAttribute('aria-describedby', 'ageGateBody');

    gate.innerHTML =
      '<div class="age-gate__inner">' +
        '<div class="age-gate__brand ducks-font" aria-hidden="true">' +
          '<span class="age-gate__brand-gold">SP</span><span class="age-gate__brand-white">BC</span>' +
        '</div>' +
        '<h1 id="ageGateTitle" class="age-gate__title">21+ · RESEARCH USE ONLY</h1>' +
        '<p id="ageGateBody" class="age-gate__body">' +
          'You must be 21 years of age or older to enter. All products sold here are research chemicals ' +
          'intended solely for laboratory research use. They are NOT for human or veterinary consumption ' +
          'of any kind. By entering you confirm you are 21+ and agree to these terms.' +
        '</p>' +
        '<div class="age-gate__actions">' +
          '<button type="button" class="age-gate__enter" id="ageGateEnter">I am 21+ — Enter</button>' +
          '<a class="age-gate__leave" id="ageGateLeave" href="https://www.google.com" rel="noopener noreferrer">Leave</a>' +
        '</div>' +
      '</div>';

    document.body.appendChild(gate);
    activeGate = gate;
    lockScroll(true);
    document.addEventListener('keydown', onKeydown, true);

    var enterBtn = document.getElementById('ageGateEnter');
    // Delegated on the overlay so the accept still fires if the press lands on the
    // button's inner text node or the button is re-rendered under us.
    gate.addEventListener('click', function (e) {
      var hit = e.target && e.target.closest ? e.target.closest('#ageGateEnter') : null;
      if (!hit) return;
      e.preventDefault();
      accept(gate);
      activeGate = null;
    });

    // Focus primary action
    requestAnimationFrame(function () {
      enterBtn.focus();
    });
  }

  function init() {
    // Soft member session only (see functions/api/products.js — "Not hard security").
    // Set it unconditionally so the price list can never be left unauthorised by a
    // dropped cookie; the overlay below is what actually blocks a non-confirmed visitor.
    setMemberCookie();
    if (isAgeOk()) return;
    showGate();
  }

  // Lets the storefront re-open the gate if it ever needs to re-confirm.
  window.spbcShowAgeGate = showGate;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
