const RATE = 100;

    async function submitCoach(e) {
      e.preventDefault();
      const err = document.getElementById('coachError');
      const ok = document.getElementById('coachOk');
      const btn = document.getElementById('coachSubmit');
      err.classList.add('hidden');
      ok.classList.add('hidden');

      if (!document.getElementById('cAgree').checked) {
        err.textContent = 'Please confirm the educational-use agreement.';
        err.classList.remove('hidden');
        return false;
      }

      const name = document.getElementById('cName').value.trim();
      const email = document.getElementById('cEmail').value.trim();
      const hours = document.getElementById('cHours').value;
      const focus = document.getElementById('cFocus').value;
      const goals = document.getElementById('cGoals').value.trim();
      const times = document.getElementById('cTimes').value.trim();

      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        err.textContent = 'Please enter your name and a valid email.';
        err.classList.remove('hidden');
        return false;
      }

      const total = (Number(hours) * RATE).toFixed(0);
      const origLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Sending…';

      // Server-side submit — actually delivers to us, no mail client needed.
      try {
        const res = await fetch('/api/coaching-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, hours, focus, times, goals }),
        });
        if (res.ok) {
          ok.textContent = 'Request sent — thanks! We’ll email you to confirm your slot. Check your inbox (and spam).';
          ok.classList.remove('hidden');
          document.getElementById('coachForm').reset();
          btn.disabled = false;
          btn.textContent = origLabel;
          return false;
        }
        // fall through to mailto fallback on server error
      } catch (_) {
        // network error — fall through to mailto
      }

      // Fallback: open the visitor's mail client with a prefilled draft.
      const subject = `SPBC Coaching request — ${hours}h · $${total} · ${focus}`;
      const body = [
        'SPBC Research Coaching Request',
        '--------------------------------',
        `Name: ${name}`,
        `Email: ${email}`,
        `Hours: ${hours} ($${RATE}/hr → $${total})`,
        `Focus: ${focus}`,
        `Preferred times: ${times || '(not specified)'}`,
        '',
        'Goals / context:',
        goals,
      ].join('\n');
      window.location.href = `mailto:springfieldpeps@proton.me?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      ok.textContent = 'Opening your email app as a backup — please hit send, or email springfieldpeps@proton.me directly.';
      ok.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = origLabel;
      return false;
    }
