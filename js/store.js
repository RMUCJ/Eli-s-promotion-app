/* ==========================================================================
   store.js — profiles and progress persistence
   --------------------------------------------------------------------------
   Everything lives in this browser's localStorage. Nothing is transmitted
   anywhere. The PIN is a "who is using this device" switch between profiles,
   NOT a security control — see README for what that does and does not mean.
   ========================================================================== */

const Store = (() => {
  const K_PROFILES = 'mqi.profiles';
  const K_ACTIVE   = 'mqi.active';
  const K_PROG     = id => `mqi.progress.${id}`;

  /* localStorage can throw (private mode, blocked site data, quota). Every
     access is guarded so the app degrades to in-memory rather than crashing. */
  const mem = {};
  let usable = true;
  try {
    localStorage.setItem('mqi.probe', '1');
    localStorage.removeItem('mqi.probe');
  } catch { usable = false; }

  function read(k, fallback) {
    try {
      const v = usable ? localStorage.getItem(k) : mem[k];
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  }
  function write(k, v) {
    const s = JSON.stringify(v);
    try { if (usable) localStorage.setItem(k, s); else mem[k] = s; }
    catch { usable = false; mem[k] = s; }
  }
  function drop(k) {
    try { if (usable) localStorage.removeItem(k); } catch {}
    delete mem[k];
  }

  /* ---- PIN hashing ------------------------------------------------------ */
  /* SHA-256 where available (https / localhost). Falls back to a non-crypto
     digest on insecure origins so the app still works over plain http. */
  async function hashPin(pin, salt) {
    const data = `mqi:${salt}:${pin}`;
    if (globalThis.crypto?.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < data.length; i++) {
      h1 = Math.imul(h1 ^ data.charCodeAt(i), 0x01000193) >>> 0;
      h2 = Math.imul(h2 + data.charCodeAt(i) * (i + 7), 0x85ebca6b) >>> 0;
    }
    return 'fb' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }

  const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---- profiles --------------------------------------------------------- */
  const profiles = () => read(K_PROFILES, []);

  async function createProfile(name, pin) {
    name = String(name || '').trim();
    if (!name) throw new Error('Please enter a name.');
    if (name.length > 40) throw new Error('That name is too long.');
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly 4 digits.');

    const list = profiles();
    if (list.some(p => p.name.toLowerCase() === name.toLowerCase()))
      throw new Error('A profile with that name already exists on this device.');

    const id = uid();
    const salt = Math.random().toString(36).slice(2, 12);
    list.push({ id, name, salt, pinHash: await hashPin(pin, salt), created: Date.now() });
    write(K_PROFILES, list);
    write(K_PROG(id), blankProgress());
    return id;
  }

  async function verifyPin(id, pin) {
    const p = profiles().find(x => x.id === id);
    if (!p) return false;
    return (await hashPin(pin, p.salt)) === p.pinHash;
  }

  async function changePin(id, oldPin, newPin) {
    if (!await verifyPin(id, oldPin)) throw new Error('Current PIN is incorrect.');
    if (!/^\d{4}$/.test(newPin)) throw new Error('New PIN must be exactly 4 digits.');
    const list = profiles();
    const p = list.find(x => x.id === id);
    p.salt = Math.random().toString(36).slice(2, 12);
    p.pinHash = await hashPin(newPin, p.salt);
    write(K_PROFILES, list);
  }

  function deleteProfile(id) {
    write(K_PROFILES, profiles().filter(p => p.id !== id));
    drop(K_PROG(id));
    if (activeId() === id) signOut();
  }

  const activeId = () => read(K_ACTIVE, null);
  const active   = () => profiles().find(p => p.id === activeId()) || null;
  const signIn   = id => write(K_ACTIVE, id);
  const signOut  = () => drop(K_ACTIVE);

  /* ---- progress --------------------------------------------------------- */
  const blankProgress = () => ({
    cards: {},                 // qid -> { box, due, seen, right, wrong, last }
    answered: 0,
    correct: 0,
    days: [],                  // 'YYYY-MM-DD' study days, for the streak
    exams: [],                 // { at, score, total, pct, mins }
    sessions: 0,
  });

  function progress(id = activeId()) {
    if (!id) return blankProgress();
    const p = read(K_PROG(id), null);
    return p ? { ...blankProgress(), ...p } : blankProgress();
  }
  function saveProgress(p, id = activeId()) {
    if (id) write(K_PROG(id), p);
  }

  const todayKey = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function markStudiedToday(p) {
    const t = todayKey();
    if (!p.days.includes(t)) p.days.push(t);
    if (p.days.length > 400) p.days = p.days.slice(-400);
  }

  /* consecutive days ending today or yesterday */
  function streak(p) {
    if (!p.days?.length) return 0;
    const set = new Set(p.days);
    const d = new Date();
    if (!set.has(todayKey(d))) {
      d.setDate(d.getDate() - 1);
      if (!set.has(todayKey(d))) return 0;
    }
    let n = 0;
    while (set.has(todayKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  /* ---- export / import (manual cross-device transfer) ------------------- */
  function exportData(id = activeId()) {
    const p = profiles().find(x => x.id === id);
    return JSON.stringify({
      format: 'mqi-prep-v1',
      exportedAt: new Date().toISOString(),
      name: p?.name ?? 'unknown',
      progress: progress(id),
    }, null, 2);
  }

  function importData(json, id = activeId()) {
    let d;
    try { d = JSON.parse(json); }
    catch { throw new Error('That file is not valid JSON.'); }
    if (d.format !== 'mqi-prep-v1' || !d.progress)
      throw new Error('That file is not an MQI Prep export.');
    const incoming = { ...blankProgress(), ...d.progress };
    const cur = progress(id);

    /* merge: keep the stronger box and the earlier due date per card */
    const cards = { ...cur.cards };
    for (const [qid, c] of Object.entries(incoming.cards || {})) {
      const e = cards[qid];
      cards[qid] = !e ? c : {
        box:   Math.max(e.box, c.box),
        due:   Math.min(e.due, c.due),
        seen:  (e.seen  || 0) + (c.seen  || 0),
        right: (e.right || 0) + (c.right || 0),
        wrong: (e.wrong || 0) + (c.wrong || 0),
        last:  Math.max(e.last || 0, c.last || 0),
      };
    }
    const merged = {
      cards,
      answered: cur.answered + incoming.answered,
      correct:  cur.correct  + incoming.correct,
      days:     [...new Set([...cur.days, ...incoming.days])].sort(),
      exams:    [...cur.exams, ...incoming.exams].sort((a, b) => a.at - b.at).slice(-50),
      sessions: cur.sessions + incoming.sessions,
    };
    saveProgress(merged, id);
    return merged;
  }

  function resetProgress(id = activeId()) { saveProgress(blankProgress(), id); }

  return {
    profiles, createProfile, verifyPin, changePin, deleteProfile,
    activeId, active, signIn, signOut,
    progress, saveProgress, blankProgress,
    markStudiedToday, streak, todayKey,
    exportData, importData, resetProgress,
    get storageWorks() { return usable; },
  };
})();
