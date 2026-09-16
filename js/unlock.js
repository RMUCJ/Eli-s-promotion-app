/* ==========================================================================
   unlock.js — decrypts the study content, then starts the app
   --------------------------------------------------------------------------
   The content ships as ciphertext (data/bank.enc.js). The AES-256-GCM key
   travels in the link fragment (#k=...). Browsers never send a fragment to
   the server, so the key reaches no host — not GitHub's, not anyone's. It is
   the link itself that grants access.

   Once a key works it is remembered on this device, so the full link is only
   needed the first time. The key is then stripped from the address bar so it
   does not linger in a screenshot or a shared tab.
   ========================================================================== */

(() => {
  const K_KEY = 'mqi.key';

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v != null) n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  };

  const b64uDecode = str => {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  };

  const readStored = () => { try { return localStorage.getItem(K_KEY); } catch { return null; } };
  const store = k => { try { localStorage.setItem(K_KEY, k); } catch {} };
  const forget = () => { try { localStorage.removeItem(K_KEY); } catch {} };

  /* Accept a bare key, or a whole link pasted in. */
  function normalise(input) {
    const s = String(input || '').trim();
    const m = s.match(/[#&?]k=([A-Za-z0-9_-]+)/);
    return (m ? m[1] : s).replace(/[^A-Za-z0-9_-]/g, '');
  }

  const keyFromUrl = () => {
    const m = location.hash.match(/[#&]k=([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  };

  async function decrypt(keyRaw) {
    const sealed = window.SEALED_BANK;
    if (!sealed) throw new Error('The sealed content file did not load.');
    if (!window.crypto?.subtle) {
      throw new Error('This browser cannot decrypt here. Open the page over https:// rather than as a local file.');
    }
    const bytes = b64uDecode(keyRaw);
    if (bytes.length !== 32) throw new Error('That key is the wrong length — it may have been cut off.');

    const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
    /* AES-GCM is authenticated: a wrong key fails here rather than yielding junk. */
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64uDecode(sealed.iv) }, key, b64uDecode(sealed.ct));

    const payload = JSON.parse(new TextDecoder().decode(plain));
    new Function('window', payload.questionsSource)(window);
    window.STUDY_NOTES = payload.notes || '';
    if (!window.QUESTION_BANK?.length) throw new Error('Content unlocked but no questions were found.');
  }

  function scrubUrl() {
    if (!keyFromUrl()) return;
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {}
  }

  /* ---- lock screen ------------------------------------------------------ */
  function renderLock(message) {
    const app = document.getElementById('app');
    app.textContent = '';

    const input = el('input', {
      type: 'text', autocomplete: 'off', autocapitalize: 'off',
      autocorrect: 'off', spellcheck: 'false', id: 'unlock-key',
      placeholder: 'Paste your study link or key',
    });
    const err = el('div', { class: 'muted', style: 'color:var(--bad);min-height:20px;margin:2px 0 8px' }, message || '');
    const btn = el('button', { class: 'btn primary', style: 'margin-bottom:0' }, 'Unlock');

    async function attempt() {
      const k = normalise(input.value);
      if (!k) { err.textContent = 'Paste the link you were given, or just the key from it.'; return; }
      btn.disabled = true; btn.textContent = 'Unlocking…'; err.textContent = '';
      try {
        await decrypt(k);
        store(k);
        scrubUrl();
        App.boot();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Unlock';
        err.textContent = /wrong length|cut off|https/.test(e.message)
          ? e.message
          : 'That key did not unlock this content. Check you copied the whole link.';
      }
    }
    btn.addEventListener('click', attempt);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });

    app.append(
      el('div', { class: 'topbar' },
        el('div', { class: 'grow' },
          el('h1', {}, 'MQI Prep'),
          el('div', { class: 'sub' }, 'Group 40 promotion interview'))),
      el('div', { class: 'card' },
        el('div', { style: 'font-size:2.2rem;text-align:center;margin:6px 0 12px' }, '🔒'),
        el('h2', { style: 'text-align:center;margin-bottom:10px' }, 'This app is locked'),
        el('p', { class: 'muted', style: 'text-align:center' },
          'The study material is encrypted. Open the private link you were given and it unlocks automatically — or paste that link below.'),
        el('label', { class: 'fld', for: 'unlock-key' },
          el('span', {}, 'Study link or key'), input),
        err, btn),
      el('div', { class: 'muted', style: 'text-align:center;font-size:.76rem;margin-top:14px' },
        'Your key is stored on this device only, so you will not need the link again on this phone.'));

    setTimeout(() => input.focus(), 80);
  }

  /* Exposed so Settings can lock the device back down. */
  window.MQILock = { forget, relock(msg) { forget(); renderLock(msg); } };

  /* ---- boot ------------------------------------------------------------- */
  async function start() {
    const fromUrl = keyFromUrl();
    const candidate = fromUrl || readStored();

    if (candidate) {
      try {
        await decrypt(candidate);
        store(candidate);
        scrubUrl();
        App.boot();
        return;
      } catch (e) {
        /* A stored key that stopped working means the content was re-sealed. */
        if (!fromUrl) forget();
        renderLock(fromUrl
          ? 'That link did not unlock this content. Check it copied in full.'
          : 'Your saved key no longer works — the content was updated. Open your link again.');
        return;
      }
    }
    renderLock();
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start);
  else start();
})();
