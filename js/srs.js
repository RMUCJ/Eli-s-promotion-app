/* ==========================================================================
   srs.js — the reinforcement engine
   --------------------------------------------------------------------------
   A Leitner box system. Each question sits in a box 0-6. Answer it right and
   it moves up a box and won't be asked again until the interval for that box
   has elapsed. Answer it wrong and it drops straight back to box 0 — due
   immediately, and re-queued before the end of the current session.

   The effect: material you know fades into the background, material you keep
   missing keeps coming back until it sticks. That is the "reinforced learning"
   part — you cannot finish a session while still getting something wrong.
   ========================================================================== */

const SRS = (() => {
  const DAY = 86400000;
  /* days until a card in box N comes back around */
  const INTERVAL = [0, 1, 2, 4, 8, 16, 32];
  const MAX_BOX  = INTERVAL.length - 1;
  const MASTER_BOX = 4;          // box 4+ counts as mastered (~8 day retention)

  const TOPICS = [
    { key:'philosophy', name:'Company Philosophy', icon:'🏛', pages:'p1–3'   },
    { key:'hr',         name:'Human Resources',    icon:'👥', pages:'p3–7'   },
    { key:'business',   name:'Business Management',icon:'📊', pages:'p7–12'  },
    { key:'vehicle',    name:'Vehicle Repair',     icon:'🔧', pages:'p12–13' },
    { key:'risk',       name:'Risk Management',    icon:'🛡', pages:'p14–17' },
    { key:'am',         name:'Area Manager',       icon:'📈', pages:'p17–22' },
  ];
  const topicName = k => TOPICS.find(t => t.key === k)?.name ?? k;
  const topicIcon = k => TOPICS.find(t => t.key === k)?.icon ?? '•';

  const blankCard = () => ({ box: 0, due: 0, seen: 0, right: 0, wrong: 0, last: 0 });
  const card = (prog, qid) => prog.cards[qid] || blankCard();

  /* Record one answer. Mutates and returns the progress object. */
  function grade(prog, qid, correct) {
    const c = { ...card(prog, qid) };
    c.seen++;
    c.last = Date.now();
    if (correct) { c.right++; c.box = Math.min(c.box + 1, MAX_BOX); }
    else         { c.wrong++; c.box = 0; }
    c.due = Date.now() + INTERVAL[c.box] * DAY;
    prog.cards[qid] = c;
    prog.answered++;
    if (correct) prog.correct++;
    Store.markStudiedToday(prog);
    return prog;
  }

  const isDue      = (prog, qid, now = Date.now()) => card(prog, qid).due <= now;
  const isNew      = (prog, qid) => !prog.cards[qid];
  const isMastered = (prog, qid) => card(prog, qid).box >= MASTER_BOX;

  /* ---- selection -------------------------------------------------------- */
  function pool(topics) {
    const all = window.QUESTION_BANK;
    if (!topics || !topics.length) return all.slice();
    const set = new Set(topics);
    return all.filter(q => set.has(q.topic));
  }

  const shuffle = a => {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [r[i], r[j]] = [r[j], r[i]];
    }
    return r;
  };

  /*  Build a study session.
      Order of priority:
        1. cards that are DUE and not yet mastered   (active recall, overdue)
        2. cards never seen                          (new material)
        3. cards that are due but mastered           (light maintenance)
        4. everything else, weakest box first        (top-up)
      Within each tier the order is shuffled, so you never memorise a sequence
      instead of the material.                                               */
  function buildSession(prog, { topics = [], size = 15, mode = 'review' } = {}) {
    const now = Date.now();
    let qs = pool(topics);

    if (mode === 'weak') {
      /* lowest box first, then most-missed; only things actually attempted */
      qs = qs.filter(q => prog.cards[q.id] && card(prog, q.id).box < MASTER_BOX);
      qs.sort((a, b) => {
        const A = card(prog, a.id), B = card(prog, b.id);
        return A.box - B.box || B.wrong - A.wrong;
      });
      return qs.slice(0, size);
    }

    if (mode === 'exam') {
      /* proportional coverage across every topic, difficulty-weighted */
      const per = {};
      for (const t of TOPICS) per[t.key] = shuffle(qs.filter(q => q.topic === t.key));
      const out = [];
      let i = 0;
      while (out.length < size) {
        let added = false;
        for (const t of TOPICS) {
          if (per[t.key][i]) { out.push(per[t.key][i]); added = true; }
          if (out.length >= size) break;
        }
        if (!added) break;
        i++;
      }
      return shuffle(out).slice(0, size);
    }

    const due     = [], fresh = [], dueMastered = [], rest = [];
    for (const q of qs) {
      if (isNew(prog, q.id))                       fresh.push(q);
      else if (isDue(prog, q.id, now))
        (isMastered(prog, q.id) ? dueMastered : due).push(q);
      else                                          rest.push(q);
    }
    rest.sort((a, b) => card(prog, a.id).box - card(prog, b.id).box);

    return [...shuffle(due), ...shuffle(fresh), ...shuffle(dueMastered), ...rest]
      .slice(0, size);
  }

  const dueCount = (prog, topics = []) => {
    const now = Date.now();
    return pool(topics).filter(q => !isNew(prog, q.id) && isDue(prog, q.id, now)).length;
  };
  const newCount = (prog, topics = []) =>
    pool(topics).filter(q => isNew(prog, q.id)).length;

  /* ---- mastery ---------------------------------------------------------- */
  /* A question's mastery is its box as a fraction of MASTER_BOX, capped at 1.
     Topic mastery is the mean across that topic's questions, so an untouched
     topic reads 0% and a fully-boxed topic reads 100%.                      */
  function topicMastery(prog, key) {
    const qs = window.QUESTION_BANK.filter(q => q.topic === key);
    if (!qs.length) return 0;
    const sum = qs.reduce((s, q) => s + Math.min(card(prog, q.id).box / MASTER_BOX, 1), 0);
    return Math.round((sum / qs.length) * 100);
  }
  function overallMastery(prog) {
    const qs = window.QUESTION_BANK;
    const sum = qs.reduce((s, q) => s + Math.min(card(prog, q.id).box / MASTER_BOX, 1), 0);
    return Math.round((sum / qs.length) * 100);
  }
  const masteredCount = prog =>
    window.QUESTION_BANK.filter(q => isMastered(prog, q.id)).length;

  /* Plain-language readiness verdict for the home screen. */
  function readiness(prog) {
    const m = overallMastery(prog);
    const seenPct = Math.round(
      window.QUESTION_BANK.filter(q => !isNew(prog, q.id)).length / window.QUESTION_BANK.length * 100
    );
    if (seenPct < 25) return { label:'Just getting started', tone:'info',
      note:'Work through each topic once — then the review queue takes over.' };
    if (m < 35) return { label:'Building the base', tone:'info',
      note:'Keep going. Repetition is what moves things out of the review queue.' };
    if (m < 60) return { label:'Getting there', tone:'warn',
      note:'Solid progress. Hit your weak spots and keep the daily review going.' };
    if (m < 80) return { label:'Interview-ready soon', tone:'warn',
      note:'Most of it is sticking. Run a full exam simulation to pressure-test it.' };
    return { label:'Interview ready', tone:'accent',
      note:'Strong across the board. Keep reviewing daily so it stays sharp.' };
  }

  return {
    TOPICS, topicName, topicIcon, INTERVAL, MAX_BOX, MASTER_BOX,
    card, grade, isDue, isNew, isMastered,
    buildSession, dueCount, newCount, shuffle, pool,
    topicMastery, overallMastery, masteredCount, readiness,
  };
})();
