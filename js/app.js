/* ==========================================================================
   app.js — views, routing and the study session loop
   ========================================================================== */

const App = (() => {
  const h = Quiz.h;
  const root = () => document.getElementById('app');

  let view = 'boot';
  let ctx  = {};              // per-view scratch state

  /* ---- helpers ---------------------------------------------------------- */
  function toast(msg, ms = 2200) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('on'), ms);
  }

  function go(v, c = {}) {
    view = v; ctx = c;
    window.scrollTo(0, 0);
    paint();
  }

  const initials = n => n.trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();

  function topbar(title, sub, { back = null, action = null } = {}) {
    return h('div', { class: 'topbar' },
      back ? h('button', { class: 'iconbtn', 'aria-label': 'Back', onclick: back }, '‹') : null,
      h('div', { class: 'grow' },
        h('h1', {}, title),
        sub ? h('div', { class: 'sub' }, sub) : null),
      action);
  }

  /* ======================================================================
     SIGN IN
     ====================================================================== */
  function viewProfiles() {
    const list = Store.profiles();
    return h('div', {},
      h('div', { class: 'topbar' },
        h('div', { class: 'grow' },
          h('h1', {}, 'MQI Prep'),
          h('div', { class: 'sub' }, 'Group 40 promotion interview'))),

      !Store.storageWorks ? h('div', { class: 'flagbox' },
        h('b', {}, 'Storage unavailable'),
        'This browser is blocking site data, so progress will not be saved between visits. Turn off private browsing, or allow site data for this page.') : null,

      list.length
        ? h('div', {},
            h('h2', { style: 'margin:6px 0 12px;font-size:.9rem;color:var(--tx-3)' }, 'WHO IS STUDYING?'),
            list.map(p => {
              const prog = Store.progress(p.id);
              return h('button', { class: 'profile-row', onclick: () => go('pin', { id: p.id }) },
                h('div', { class: 'avatar' }, initials(p.name)),
                h('div', { class: 'pi' },
                  h('b', {}, p.name),
                  h('span', {}, `${SRS.overallMastery(prog)}% mastery · ${prog.answered} answered`)),
                h('span', { style: 'color:var(--tx-3)' }, '›'));
            }),
            h('hr', { class: 'hr' }))
        : h('div', { class: 'card' },
            h('h2', { style: 'margin-bottom:8px' }, 'Welcome'),
            h('p', { class: 'muted', style: 'margin:0' },
              'This app drills you on the Group 40 MQI study guide using spaced repetition: questions you miss keep coming back until they stick. Create a profile to track your progress.')),

      h('button', { class: 'btn primary', onclick: () => go('create') }, '+  New profile'),

      h('div', { class: 'muted', style: 'text-align:center;margin-top:18px;font-size:.76rem' },
        'Everything is stored on this device only. Nothing is uploaded.'));
  }

  function viewCreate() {
    let name = '', pin = '', pin2 = '';
    const err = h('div', { class: 'muted', style: 'color:var(--bad);min-height:20px;margin-bottom:4px' });

    const submit = async () => {
      err.textContent = '';
      if (pin !== pin2) { err.textContent = 'The two PINs do not match.'; return; }
      try {
        const id = await Store.createProfile(name, pin);
        Store.signIn(id);
        toast('Profile created');
        go('home');
      } catch (e) { err.textContent = e.message; }
    };

    return h('div', {},
      topbar('New profile', 'Stored on this device', { back: () => go('profiles') }),
      h('div', { class: 'card' },
        h('label', { class: 'fld' },
          h('span', {}, 'Your name'),
          h('input', { type: 'text', placeholder: 'e.g. Eli', maxlength: '40', autocomplete: 'off',
            oninput: e => name = e.target.value })),
        h('label', { class: 'fld' },
          h('span', {}, '4-digit PIN'),
          h('input', { type: 'password', inputmode: 'numeric', maxlength: '4', autocomplete: 'off',
            placeholder: '••••', oninput: e => pin = e.target.value.replace(/\D/g, '') })),
        h('label', { class: 'fld' },
          h('span', {}, 'Confirm PIN'),
          h('input', { type: 'password', inputmode: 'numeric', maxlength: '4', autocomplete: 'off',
            placeholder: '••••', oninput: e => pin2 = e.target.value.replace(/\D/g, ''),
            onkeydown: e => { if (e.key === 'Enter') submit(); } })),
        err,
        h('button', { class: 'btn primary', onclick: submit }, 'Create profile')),
      h('div', { class: 'muted', style: 'text-align:center;font-size:.76rem' },
        'The PIN just keeps profiles separate on a shared device. It is not encryption — anyone with access to this browser could read the stored data.'));
  }

  function viewPin() {
    const p = Store.profiles().find(x => x.id === ctx.id);
    if (!p) return viewProfiles();
    let pin = '';
    const dots = h('div', { class: 'pinrow' }, [0,1,2,3].map(() => h('div', { class: 'pindot' })));
    const err  = h('div', { class: 'muted', style: 'color:var(--bad);text-align:center;min-height:20px' });

    const paintDots = () =>
      [...dots.children].forEach((d, i) => d.classList.toggle('on', i < pin.length));

    const tryPin = async () => {
      if (await Store.verifyPin(p.id, pin)) {
        Store.signIn(p.id);
        go('home');
      } else {
        err.textContent = 'Incorrect PIN.';
        pin = ''; paintDots();
      }
    };
    const push = d => {
      if (pin.length >= 4) return;
      pin += d; paintDots(); err.textContent = '';
      if (pin.length === 4) setTimeout(tryPin, 130);
    };

    return h('div', {},
      topbar(p.name, 'Enter your PIN', { back: () => go('profiles') }),
      h('div', { style: 'text-align:center;margin:10px 0 4px' },
        h('div', { class: 'avatar', style: 'margin:0 auto;width:60px;height:60px;font-size:1.4rem' }, initials(p.name))),
      dots, err,
      h('div', { class: 'keypad' },
        [1,2,3,4,5,6,7,8,9].map(n => h('button', { onclick: () => push(String(n)) }, String(n))),
        h('button', { class: 'alt', onclick: () => go('forgot', { id: p.id }) }, 'Forgot'),
        h('button', { onclick: () => push('0') }, '0'),
        h('button', { class: 'alt', onclick: () => { pin = pin.slice(0, -1); paintDots(); } }, '⌫')));
  }

  function viewForgot() {
    const p = Store.profiles().find(x => x.id === ctx.id);
    return h('div', {},
      topbar('Forgot PIN', p?.name ?? '', { back: () => go('pin', { id: ctx.id }) }),
      h('div', { class: 'card' },
        h('p', { class: 'muted' },
          'There is no PIN recovery, because nothing is stored on a server — the PIN only exists in this browser. You can delete this profile and start a new one, but that erases its progress.'),
        h('p', { class: 'muted' },
          'If you still have a backup file from Settings → Export, you can import it into the new profile to restore your progress.'),
        h('button', { class: 'btn danger', onclick: () => {
          if (confirm(`Delete "${p.name}" and all of its progress? This cannot be undone.`)) {
            Store.deleteProfile(p.id);
            toast('Profile deleted');
            go('profiles');
          }
        } }, 'Delete this profile')));
  }

  /* ======================================================================
     HOME
     ====================================================================== */
  function viewHome() {
    const me   = Store.active();
    if (!me) return viewProfiles();
    const prog = Store.progress();
    const due  = SRS.dueCount(prog);
    const fresh= SRS.newCount(prog);
    const rd   = SRS.readiness(prog);
    const acc  = prog.answered ? Math.round(prog.correct / prog.answered * 100) : 0;

    const reviewSub = due
      ? `${due} question${due === 1 ? '' : 's'} due for review`
      : fresh
        ? `${fresh} you haven't seen yet`
        : 'All caught up — tap for a refresher';

    return h('div', {},
      topbar(`Hi, ${me.name.split(/\s+/)[0]}`, rd.label, {
        action: h('button', { class: 'iconbtn', 'aria-label': 'Settings', onclick: () => go('settings') }, '⚙'),
      }),

      h('div', { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('b', {}, `${SRS.overallMastery(prog)}%`), h('span', {}, 'Mastery')),
        h('div', { class: 'stat' }, h('b', {}, Store.streak(prog)), h('span', {}, 'Day streak')),
        h('div', { class: 'stat' }, h('b', {}, prog.answered ? `${acc}%` : '—'), h('span', {}, 'Accuracy'))),

      h('div', { class: 'card tight' },
        h('div', { class: 'topic-row', style: 'margin-bottom:8px' },
          h('div', { class: 'nm' }, h('b', {}, `${SRS.masteredCount(prog)} of ${window.QUESTION_BANK.length} mastered`)),
          h('span', { class: `pill ${rd.tone}` }, rd.label)),
        h('div', { class: 'bar' }, h('i', { style: `width:${SRS.overallMastery(prog)}%` })),
        h('div', { class: 'muted', style: 'margin-top:9px' }, rd.note)),

      h('button', { class: 'tile hero', onclick: () => startSession({ mode: 'review', size: 15 }) },
        h('span', { class: 'ico' }, '⚡'),
        h('span', { class: 't' }, h('b', {}, 'Daily Review'), h('span', {}, reviewSub)),
        h('span', { class: 'chev' }, '›')),

      h('button', { class: 'tile', onclick: () => go('topics') },
        h('span', { class: 'ico' }, '📚'),
        h('span', { class: 't' }, h('b', {}, 'Study by Topic'),
          h('span', {}, 'Drill one section at a time')),
        h('span', { class: 'chev' }, '›')),

      h('button', { class: 'tile', onclick: () => {
          const n = window.QUESTION_BANK.filter(q => prog.cards[q.id] && SRS.card(prog, q.id).box < SRS.MASTER_BOX).length;
          if (!n) { toast('No weak spots yet — answer some questions first.'); return; }
          startSession({ mode: 'weak', size: Math.min(15, n) });
        } },
        h('span', { class: 'ico' }, '🎯'),
        h('span', { class: 't' }, h('b', {}, 'Weak Spots'),
          h('span', {}, 'The questions you keep missing')),
        h('span', { class: 'chev' }, '›')),

      h('button', { class: 'tile', onclick: () => go('examsetup') },
        h('span', { class: 'ico' }, '📝'),
        h('span', { class: 't' }, h('b', {}, 'Exam Simulation'),
          h('span', {}, 'Timed, mixed, no hints until the end')),
        h('span', { class: 'chev' }, '›')),

      h('button', { class: 'tile', onclick: () => go('progress') },
        h('span', { class: 'ico' }, '📈'),
        h('span', { class: 't' }, h('b', {}, 'Progress'),
          h('span', {}, 'Mastery by topic and exam history')),
        h('span', { class: 'chev' }, '›')),

      h('button', { class: 'tile', onclick: () => go('flagged') },
        h('span', { class: 'ico' }, '⚠️'),
        h('span', { class: 't' }, h('b', {}, 'Verify With Your AM'),
          h('span', {}, `${window.QUESTION_BANK.filter(q => q.flag).length} items where the guide is unclear`)),
        h('span', { class: 'chev' }, '›')));
  }

  /* ======================================================================
     TOPICS
     ====================================================================== */
  function viewTopics() {
    const prog = Store.progress();
    return h('div', {},
      topbar('Study by Topic', 'Pick a section to drill', { back: () => go('home') }),
      SRS.TOPICS.map(t => {
        const qs  = window.QUESTION_BANK.filter(q => q.topic === t.key);
        const m   = SRS.topicMastery(prog, t.key);
        const due = SRS.dueCount(prog, [t.key]);
        return h('button', { class: 'tile', onclick: () => startSession({ mode: 'review', topics: [t.key], size: Math.min(15, qs.length) }) },
          h('span', { class: 'ico' }, t.icon),
          h('span', { class: 't' },
            h('b', {}, t.name),
            h('span', {}, `${qs.length} questions · guide ${t.pages}${due ? ` · ${due} due` : ''}`),
            h('span', { class: 'bar thin', style: 'margin-top:7px' }, h('i', { style: `width:${m}%` }))),
          h('span', { class: 'chev' }, `${m}%`));
      }));
  }

  /* ======================================================================
     EXAM SETUP
     ====================================================================== */
  function viewExamSetup() {
    let size = 40;
    const sizes = [20, 40, 60];
    const chips = h('div', { class: 'chips' },
      sizes.map(n => h('button', {
        class: 'chip' + (n === size ? ' on' : ''),
        onclick(){
          size = n;
          [...chips.children].forEach((c, i) => c.classList.toggle('on', sizes[i] === n));
        },
      }, `${n} questions`)));

    return h('div', {},
      topbar('Exam Simulation', 'Pressure-test what you know', { back: () => go('home') }),
      h('div', { class: 'card' },
        h('h3', { style: 'margin-bottom:9px' }, 'How this differs from review'),
        h('p', { class: 'muted', style: 'margin:0' },
          'Questions are drawn evenly across all six topics. You get no feedback until the end, and the clock runs. Your answers still feed the review system, so anything you miss comes back in Daily Review.')),
      h('div', { class: 'card' },
        h('h3', { style: 'margin-bottom:10px' }, 'Length'),
        chips,
        h('button', { class: 'btn primary', style: 'margin:4px 0 0',
          onclick: () => startSession({ mode: 'exam', size, instant: false }) }, 'Start exam')));
  }

  /* ======================================================================
     SESSION
     ====================================================================== */
  function startSession({ mode = 'review', topics = [], size = 15, instant = true } = {}) {
    const prog = Store.progress();
    const qs = SRS.buildSession(prog, { topics, size, mode });
    if (!qs.length) { toast('Nothing to study here yet.'); return; }
    go('session', {
      mode, instant, queue: qs.slice(), total: qs.length,
      i: 0, correct: 0, wrong: [], answers: [],
      requeued: new Set(), startedAt: Date.now(),
    });
  }

  function viewSession() {
    const s = ctx;
    const q = s.queue[s.i];
    if (!q) return viewResults();

    const prog = Store.progress();
    const c = SRS.card(prog, q.id);

    let answered = false;
    const dock = h('div', { class: 'dock' });
    const body = h('div', {});

    const widget = Quiz.render(q, () => {
      if (!answered) submitBtn.disabled = widget.read() === null;
    });

    const submitBtn = h('button', { class: 'btn primary', disabled: true, onclick: () => submit() }, 'Check answer');

    function submit() {
      if (answered) return;
      const ans = widget.read();
      if (ans === null) return;
      answered = true;

      const ok = Quiz.check(q, ans);
      widget.showResult(ok);

      const p = Store.progress();
      SRS.grade(p, q.id, ok);
      p.sessions = p.sessions || 0;
      Store.saveProgress(p);

      if (ok) s.correct++;
      else    s.wrong.push(q);
      s.answers.push({ q, ans, ok });

      /* --- reinforcement ------------------------------------------------
         A missed question is pushed back into THIS session a few slots
         later, so you re-answer it while the explanation is still fresh.
         It is only re-queued once, to keep sessions finite.               */
      if (!ok && s.instant && !s.requeued.has(q.id)) {
        s.requeued.add(q.id);
        const at = Math.min(s.i + 3, s.queue.length);
        s.queue.splice(at, 0, q);
        s.total = s.queue.length;
      }

      if (s.instant) {
        dock.textContent = '';
        body.append(feedback(q, ok));
        dock.append(h('button', { class: 'btn primary', onclick: next },
          s.i + 1 >= s.queue.length ? 'See results' : 'Next question'));
        dock.querySelector('button').scrollIntoView({ block: 'nearest' });
      } else {
        next();
      }
    }

    function next() { s.i++; paint(); }

    function feedback(q, ok) {
      return h('div', {},
        h('div', { class: `fb ${ok ? 'ok' : 'no'}` },
          h('div', { class: 'hd' }, ok ? '✓ Correct' : '✕ Not quite'),
          !ok ? h('div', { class: 'bd', style: 'margin-bottom:8px' },
            h('b', {}, 'Answer: '), Quiz.answerText(q)) : null,
          h('div', { class: 'bd' }, q.explain),
          h('div', { class: 'cite' }, `Source: ${q.cite}`)),
        q.flag ? h('div', { class: 'flagbox' },
          h('b', {}, '⚠ Verify this with your AM'), q.flag) : null,
        (!ok && s.instant && s.requeued.has(q.id))
          ? h('div', { class: 'muted', style: 'text-align:center;margin-bottom:6px' },
              'You will see this one again before the session ends.')
          : null);
    }

    const pct = Math.round(s.i / s.queue.length * 100);
    const modeLabel = { review:'Review', weak:'Weak spots', exam:'Exam' }[s.mode] ?? 'Review';

    body.append(
      h('div', { class: 'qmeta' },
        h('span', { class: 'pill accent' }, SRS.topicIcon(q.topic) + ' ' + SRS.topicName(q.topic)),
        h('span', { class: 'pill' }, Quiz.TYPE_LABEL[q.type]),
        c.seen ? h('span', { class: 'pill info' }, c.box >= SRS.MASTER_BOX ? 'Mastered' : `Box ${c.box}`) : null,
        q.flag && s.instant ? h('span', { class: 'pill warn' }, '⚠ Check w/ AM') : null),
      h('h2', { class: 'qprompt' }, q.prompt),
      widget.el);

    dock.append(submitBtn);
    if (widget.focus) setTimeout(widget.focus, 60);

    return h('div', {},
      h('div', { class: 'qtop' },
        h('button', { class: 'x', 'aria-label': 'End session',
          onclick: () => {
            if (s.i === 0 || confirm('End this session? Your answers so far are already saved.')) go('home');
          } }, '✕'),
        h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })),
        h('div', { class: 'ct' }, `${s.i + 1}/${s.queue.length}`)),
      s.mode === 'exam' ? h('div', { class: 'muted', style: 'text-align:center;margin:-6px 0 12px;font-size:.75rem' },
        `${modeLabel} — results at the end`) : null,
      body, dock);
  }

  /* ======================================================================
     RESULTS
     ====================================================================== */
  function viewResults() {
    const s = ctx;
    const pct  = Math.round(s.correct / s.answers.length * 100) || 0;
    const mins = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));

    if (s.mode === 'exam' && !s.saved) {
      s.saved = true;
      const p = Store.progress();
      p.exams.push({ at: Date.now(), score: s.correct, total: s.answers.length, pct, mins });
      if (p.exams.length > 50) p.exams = p.exams.slice(-50);
      Store.saveProgress(p);
    }

    const verdict =
      pct >= 90 ? { t: 'Excellent', s: 'That is interview-ready on this material.' } :
      pct >= 75 ? { t: 'Good work',  s: 'Solid. Review the misses below and run it again.' } :
      pct >= 50 ? { t: 'Getting there', s: 'Focus on the misses — they are back in your review queue.' } :
                  { t: 'Keep at it', s: 'Everything you missed will come back until it sticks.' };

    return h('div', {},
      topbar('Session complete', verdict.t, { back: () => go('home') }),
      h('div', { class: 'card' },
        h('div', { class: 'score-ring' },
          h('div', { class: 'big', style: `color:${pct >= 75 ? 'var(--accent)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)'}` }, `${pct}%`),
          h('div', { class: 'lbl' }, `${s.correct} of ${s.answers.length} correct · ${mins} min`)),
        h('div', { class: 'muted', style: 'text-align:center;margin-top:6px' }, verdict.s)),

      s.wrong.length
        ? h('div', { class: 'card' },
            h('h3', { style: 'margin-bottom:12px' }, `Review — ${s.wrong.length} missed`),
            s.wrong.map(q => h('div', { class: 'rev-item' },
              h('div', { class: 'q' }, q.prompt),
              h('div', { class: 'a' }, h('b', { style: 'color:var(--accent)' }, 'Answer: '), Quiz.answerText(q)),
              h('div', { class: 'a', style: 'margin-top:5px' }, q.explain),
              h('div', { class: 'cite', style: 'font-size:.72rem;color:var(--tx-3);font-style:italic;margin-top:4px' }, q.cite),
              q.flag ? h('div', { class: 'flagbox', style: 'margin:8px 0 0' },
                h('b', {}, '⚠ Verify with your AM'), q.flag) : null)))
        : h('div', { class: 'card' },
            h('div', { style: 'text-align:center;padding:6px 0' },
              h('div', { style: 'font-size:2rem;margin-bottom:6px' }, '🎉'),
              h('div', {}, 'Perfect session — nothing missed.'))),

      h('div', { class: 'dock' },
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn ghost', onclick: () => go('home') }, 'Home'),
          h('button', { class: 'btn primary', onclick: () =>
            startSession({ mode: s.mode, size: s.total, instant: s.instant }) }, 'Another round'))));
  }

  /* ======================================================================
     PROGRESS
     ====================================================================== */
  function viewProgress() {
    const prog = Store.progress();
    const acc  = prog.answered ? Math.round(prog.correct / prog.answered * 100) : 0;
    const exams = prog.exams.slice().reverse();

    return h('div', {},
      topbar('Progress', `${prog.answered} questions answered`, { back: () => go('home') }),

      h('div', { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('b', {}, `${SRS.overallMastery(prog)}%`), h('span', {}, 'Mastery')),
        h('div', { class: 'stat' }, h('b', {}, `${acc}%`), h('span', {}, 'Accuracy')),
        h('div', { class: 'stat' }, h('b', {}, Store.streak(prog)), h('span', {}, 'Streak'))),

      h('div', { class: 'card' },
        h('h3', { style: 'margin-bottom:14px' }, 'Mastery by topic'),
        SRS.TOPICS.map(t => {
          const m = SRS.topicMastery(prog, t.key);
          const qs = window.QUESTION_BANK.filter(q => q.topic === t.key);
          const mastered = qs.filter(q => SRS.isMastered(prog, q.id)).length;
          return h('div', { class: 'topic-row' },
            h('div', { class: 'nm' }, `${t.icon} ${t.name}`,
              h('small', {}, `${mastered}/${qs.length} mastered`)),
            h('div', { class: 'bar' }, h('i', { style: `width:${m}%` })),
            h('div', { class: 'pc' }, `${m}%`));
        })),

      h('div', { class: 'card' },
        h('h3', { style: 'margin-bottom:10px' }, 'How mastery is measured'),
        h('p', { class: 'muted', style: 'margin:0' },
          `Each question sits in a box from 0 to ${SRS.MAX_BOX}. Answer it right and it moves up one box and goes quiet for longer (${SRS.INTERVAL.slice(1).join(', ')} days). Miss it and it drops to box 0 and comes straight back. A question counts as mastered at box ${SRS.MASTER_BOX}.`)),

      exams.length
        ? h('div', { class: 'card' },
            h('h3', { style: 'margin-bottom:12px' }, 'Exam history'),
            exams.slice(0, 12).map(e => h('div', { class: 'topic-row' },
              h('div', { class: 'nm' },
                new Date(e.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                h('small', {}, `${e.score}/${e.total} · ${e.mins} min`)),
              h('div', { class: 'bar' }, h('i', { style: `width:${e.pct}%` })),
              h('div', { class: 'pc' }, `${e.pct}%`))))
        : null);
  }

  /* ----------------------------------------------------------------------
     Minimal markdown rendering for the sealed study notes. Deliberately
     small: only the constructs those notes actually use — headings, bold,
     inline code, bullets, tables, rules and paragraphs.
     ---------------------------------------------------------------------- */
  function mdInline(text) {
    const frag = document.createDocumentFragment();
    /* split on **bold** and `code`, keeping the delimiters */
    const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('**') && part.endsWith('**'))
        frag.append(h('b', {}, part.slice(2, -2)));
      else if (part.startsWith('`') && part.endsWith('`'))
        frag.append(h('code', { style: 'background:var(--bg);padding:1px 5px;border-radius:5px;font-size:.86em' },
          part.slice(1, -1)));
      else frag.append(document.createTextNode(part));
    }
    return frag;
  }

  function renderMarkdown(md) {
    const out = h('div', { class: 'notes' });
    const lines = String(md).split('\n');
    let list = null, table = null;

    const closeBlocks = () => { list = null; table = null; };

    for (const raw of lines) {
      const line = raw.trimEnd();

      if (!line.trim()) { closeBlocks(); continue; }

      if (/^\s*(---|===)+\s*$/.test(line)) {
        closeBlocks(); out.append(h('hr', { class: 'hr' })); continue;
      }
      const hd = line.match(/^(#{1,4})\s+(.*)$/);
      if (hd) {
        closeBlocks();
        const lvl = hd[1].length;
        const size = [0, 1.15, 1.02, .92, .86][lvl];
        out.append(h(lvl <= 2 ? 'h2' : 'h3',
          { style: `font-size:${size}rem;margin:${lvl <= 2 ? '20px' : '15px'} 0 8px` },
          mdInline(hd[2])));
        continue;
      }
      /* table row */
      if (/^\s*\|/.test(line)) {
        const cells = line.split('|').slice(1, -1).map(c => c.trim());
        if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;   // separator row
        if (!table) {
          table = h('div', { style: 'display:grid;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:10px 0' });
          table.style.gridTemplateColumns = `repeat(${cells.length}, minmax(0,1fr))`;
          table._head = true;
          out.append(table);
        }
        for (const c of cells) {
          table.append(h('div', {
            style: `background:var(--bg-2);padding:9px 10px;font-size:.82rem;line-height:1.4${table._head ? ';font-weight:650' : ''}`,
          }, mdInline(c)));
        }
        table._head = false;
        continue;
      }
      table = null;
      /* bullet */
      const bl = line.match(/^\s*[-*]\s+(.*)$/);
      if (bl) {
        if (!list) { list = h('ul', { style: 'margin:6px 0 10px;padding-left:20px' }); out.append(list); }
        list.append(h('li', { style: 'font-size:.88rem;line-height:1.55;margin-bottom:5px;color:var(--tx-2)' },
          mdInline(bl[1])));
        continue;
      }
      list = null;
      out.append(h('p', { style: 'font-size:.88rem;line-height:1.6;color:var(--tx-2);margin:0 0 10px' },
        mdInline(line)));
    }
    return out;
  }

  function viewNotes() {
    const md = window.STUDY_NOTES || '';
    return h('div', {},
      topbar('Study Notes', 'Where the guide is unclear', { back: () => go('flagged') }),
      md
        ? h('div', { class: 'card' }, renderMarkdown(md))
        : h('div', { class: 'empty' }, h('div', { class: 'em' }, '📄'), 'No notes were bundled with this content.'));
  }

  /* ======================================================================
     FLAGGED ITEMS
     ====================================================================== */
  function viewFlagged() {
    const flagged = window.QUESTION_BANK.filter(q => q.flag);
    return h('div', {},
      topbar('Verify With Your AM', `${flagged.length} unclear items`, { back: () => go('home') }),
      h('div', { class: 'card' },
        h('p', { class: 'muted' },
          'These are places where the study guide itself is ambiguous, contradicts itself, or has an apparent typo. The app still quizzes you on them using the most defensible reading — but confirm each one before your interview.'),
        window.STUDY_NOTES
          ? h('button', { class: 'btn sm', style: 'margin-top:4px', onclick: () => go('notes') },
              '📄  Read the full source notes')
          : null),
      flagged.map(q => h('div', { class: 'card' },
        h('div', { class: 'qmeta' },
          h('span', { class: 'pill accent' }, SRS.topicIcon(q.topic) + ' ' + SRS.topicName(q.topic)),
          h('span', { class: 'pill' }, q.cite)),
        h('div', { style: 'font-weight:600;margin-bottom:8px;font-size:.95rem;line-height:1.4' }, q.prompt),
        h('div', { class: 'muted', style: 'margin-bottom:10px' },
          h('b', { style: 'color:var(--accent)' }, 'App uses: '), Quiz.answerText(q)),
        h('div', { class: 'flagbox', style: 'margin:0' },
          h('b', {}, '⚠ Why this is flagged'), q.flag))));
  }

  /* ======================================================================
     SETTINGS
     ====================================================================== */
  function viewSettings() {
    const me = Store.active();
    const prog = Store.progress();

    const doExport = () => {
      const blob = new Blob([Store.exportData()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `mqi-prep-${me.name.replace(/\W+/g, '-').toLowerCase()}-${Store.todayKey()}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Backup downloaded');
    };

    const doImport = () => {
      const inp = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
      inp.addEventListener('change', () => {
        const f = inp.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => {
          try { Store.importData(r.result); toast('Progress merged'); paint(); }
          catch (e) { toast(e.message, 3200); }
        };
        r.readAsText(f);
      });
      document.body.append(inp); inp.click(); inp.remove();
    };

    return h('div', {},
      topbar('Settings', me?.name ?? '', { back: () => go('home') }),

      h('div', { class: 'card' },
        h('h3', { style: 'margin-bottom:10px' }, 'Back up & transfer'),
        h('p', { class: 'muted' },
          'Progress lives in this browser only. To move it to another device — or to protect it before clearing your browser — export a backup file and import it there.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn sm', style: 'flex:1', onclick: doExport }, '⬇  Export'),
          h('button', { class: 'btn sm', style: 'flex:1', onclick: doImport }, '⬆  Import'))),

      h('div', { class: 'card' },
        h('h3', { style: 'margin-bottom:10px' }, 'Change PIN'),
        (() => {
          let a = '', b = '';
          const e = h('div', { class: 'muted', style: 'color:var(--bad);min-height:18px' });
          return h('div', {},
            h('label', { class: 'fld' }, h('span', {}, 'Current PIN'),
              h('input', { type: 'password', inputmode: 'numeric', maxlength: '4', placeholder: '••••',
                oninput: ev => a = ev.target.value.replace(/\D/g, '') })),
            h('label', { class: 'fld' }, h('span', {}, 'New PIN'),
              h('input', { type: 'password', inputmode: 'numeric', maxlength: '4', placeholder: '••••',
                oninput: ev => b = ev.target.value.replace(/\D/g, '') })),
            e,
            h('button', { class: 'btn sm', onclick: async () => {
              try { await Store.changePin(me.id, a, b); toast('PIN updated'); paint(); }
              catch (x) { e.textContent = x.message; }
            } }, 'Update PIN'));
        })()),

      h('div', { class: 'card' },
        h('h3', { style: 'margin-bottom:10px' }, 'About this app'),
        h('p', { class: 'muted' },
          `${window.QUESTION_BANK.length} questions built from the 22-page Group 40 MQI study guide. Every question cites the page it came from, and the answers are machine-checked against the source text on every change.`),
        h('p', { class: 'muted' },
          'The study content is encrypted and only your link can open it. The key is held on this device and is never sent anywhere.'),
        h('p', { class: 'muted', style: 'margin:0' },
          `You have answered ${prog.answered} questions with ${prog.correct} correct across ${prog.days.length} study day${prog.days.length === 1 ? '' : 's'}.`)),

      h('div', { class: 'card' },
        h('h3', { style: 'margin-bottom:10px' }, 'Account'),
        h('button', { class: 'btn', onclick: () => { Store.signOut(); go('profiles'); } }, 'Sign out'),
        h('button', { class: 'btn', onclick: () => {
          if (confirm('Lock this device? You will need your study link again to get back in. Study progress is kept.')) {
            Store.signOut();
            window.MQILock?.relock('Locked. Open your study link to unlock again.');
          }
        } }, '🔒  Lock this device'),
        h('button', { class: 'btn danger', onclick: () => {
          if (confirm('Reset ALL progress for this profile? Scores, mastery and history are erased. This cannot be undone.')) {
            Store.resetProgress(); toast('Progress reset'); go('home');
          }
        } }, 'Reset my progress'),
        h('button', { class: 'btn danger', style: 'margin-bottom:0', onclick: () => {
          if (confirm(`Delete the profile "${me.name}" entirely? This cannot be undone.`)) {
            Store.deleteProfile(me.id); toast('Profile deleted'); go('profiles');
          }
        } }, 'Delete profile')));
  }

  /* ======================================================================
     PAINT
     ====================================================================== */
  const VIEWS = {
    profiles: viewProfiles, create: viewCreate, pin: viewPin, forgot: viewForgot,
    home: viewHome, topics: viewTopics, examsetup: viewExamSetup,
    session: viewSession, results: viewResults, progress: viewProgress,
    flagged: viewFlagged, notes: viewNotes, settings: viewSettings,
  };

  function paint() {
    const el = root();
    el.textContent = '';
    try {
      el.append((VIEWS[view] ?? viewHome)());
    } catch (e) {
      /* Never leave a blank screen: show the failure and a way out. */
      console.error('view "' + view + '" failed', e);
      el.append(h('div', { class: 'empty' },
        h('div', { class: 'em' }, '⚠️'),
        h('p', {}, 'Something went wrong drawing this screen.'),
        h('p', { class: 'muted', style: 'font-size:.74rem;word-break:break-word' }, String(e && e.message || e)),
        h('button', { class: 'btn primary', style: 'margin-top:14px',
          onclick: () => go(Store.activeId() ? 'home' : 'profiles') }, 'Back to safety')));
    }
  }

  function boot() {
    if (!window.QUESTION_BANK?.length) {
      root().append(h('div', { class: 'empty' },
        h('div', { class: 'em' }, '⚠️'), 'Question bank failed to load.'));
      return;
    }
    view = Store.activeId() && Store.active() ? 'home' : 'profiles';
    paint();
  }

  return { boot, go, toast };
})();

/* Boot is driven by js/unlock.js, which starts the app only after the sealed
   study content has been decrypted with the key from the study link. */
