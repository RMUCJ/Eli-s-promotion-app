/* ==========================================================================
   quiz.js — rendering and grading for each question type
   --------------------------------------------------------------------------
   Every renderer returns { el, read, showResult } where
     el          the DOM node to mount
     read()      the learner's current answer, or null if incomplete
     showResult(correct) paint the right/wrong state on the widget
   Grading lives in `check()` and is pure: (question, answer) -> boolean.
   ========================================================================== */

const Quiz = (() => {

  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) e.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  };

  /* normalise free text: lowercase, strip punctuation and filler words */
  const norm = s => String(s ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^a-z0-9$%/. ]/g, ' ')
    .replace(/\b(the|a|an|our|your|is|are|of)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const sameSet = (a, b) =>
    a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

  /* ---- grading (pure) --------------------------------------------------- */
  function check(q, ans) {
    if (ans === null || ans === undefined) return false;
    switch (q.type) {
      case 'mc':    return ans === q.answer;
      case 'tf':    return ans === q.answer;
      case 'multi': return Array.isArray(ans) && sameSet(ans, q.answer);
      case 'order': return Array.isArray(ans) &&
                           ans.length === q.items.length &&
                           ans.every((v, i) => v === q.items[i]);
      /* value-based: two rows may legitimately share the same right-hand
         value (e.g. two taxes both "$2/day"), so compare values not indices */
      case 'match': return Array.isArray(ans) &&
                           q.pairs.every((p, i) => ans[i] === p[1]);
      case 'fill': {
        const a = norm(ans);
        if (!a) return false;
        return q.accept.some(acc => {
          const n = norm(acc);
          return a === n || (n.length > 6 && (a.includes(n) || n.includes(a)));
        });
      }
      case 'numeric': {
        const v = parseFloat(String(ans).replace(/[$,\s%]/g, ''));
        return Number.isFinite(v) && Math.abs(v - q.answer) <= (q.tol ?? 0);
      }
      default: return false;
    }
  }

  /* human-readable correct answer, used in the exam review list */
  function answerText(q) {
    switch (q.type) {
      case 'mc':    return q.choices[q.answer];
      case 'tf':    return q.answer ? 'True' : 'False';
      case 'multi': return q.answer.map(i => q.choices[i]).join(' · ');
      case 'order': return q.items.map((t, i) => `${i + 1}. ${t}`).join('  ');
      case 'match': return q.pairs.map(p => `${p[0]} → ${p[1]}`).join(' · ');
      case 'fill':  return q.answer;
      case 'numeric': return `${q.unit === '$' ? '$' : ''}${q.answer}${q.unit && q.unit !== '$' ? ' ' + q.unit : ''}`;
      default: return '';
    }
  }

  /* ---- renderers -------------------------------------------------------- */

  function renderMC(q, onChange) {
    let sel = null;
    const btns = q.choices.map((c, i) => {
      const b = h('button', {
        class: 'choice', type: 'button',
        onclick: () => {
          sel = i;
          btns.forEach((x, j) => x.classList.toggle('sel', j === i));
          onChange();
        },
      }, h('span', { class: 'mark' }, '✓'), h('span', {}, c));
      return b;
    });
    return {
      el: h('div', {}, btns),
      read: () => sel,
      showResult() {
        btns.forEach((b, i) => {
          b.disabled = true;
          if (i === q.answer) b.classList.add('right');
          else if (i === sel) b.classList.add('wrong');
          b.classList.remove('sel');
        });
      },
    };
  }

  function renderTF(q, onChange) {
    let sel = null;
    const opts = [true, false];
    const btns = opts.map(v => h('button', {
      class: 'choice', type: 'button',
      onclick: () => {
        sel = v;
        btns.forEach((x, j) => x.classList.toggle('sel', opts[j] === v));
        onChange();
      },
    }, h('span', { class: 'mark' }, '✓'), h('span', {}, v ? 'True' : 'False')));
    return {
      el: h('div', {}, btns),
      read: () => sel,
      showResult() {
        btns.forEach((b, j) => {
          b.disabled = true;
          if (opts[j] === q.answer) b.classList.add('right');
          else if (opts[j] === sel) b.classList.add('wrong');
          b.classList.remove('sel');
        });
      },
    };
  }

  function renderMulti(q, onChange) {
    const sel = new Set();
    const btns = q.choices.map((c, i) => h('button', {
      class: 'choice', type: 'button', 'data-box': '1',
      onclick(){
        sel.has(i) ? sel.delete(i) : sel.add(i);
        this.classList.toggle('sel', sel.has(i));
        onChange();
      },
    }, h('span', { class: 'mark' }, '✓'), h('span', {}, c)));
    return {
      el: h('div', {},
        h('div', { class: 'muted', style: 'margin:-4px 0 10px' }, 'Select every correct option.'),
        btns),
      read: () => (sel.size ? [...sel] : null),
      showResult() {
        btns.forEach((b, i) => {
          b.disabled = true;
          b.classList.remove('sel');
          const should = q.answer.includes(i), did = sel.has(i);
          if (should && did)       b.classList.add('right');
          else if (!should && did) b.classList.add('wrong');
          else if (should && !did) b.classList.add('miss');
        });
      },
    };
  }

  function renderOrder(q, onChange) {
    let order = SRS.shuffle(q.items);
    /* guarantee the shuffle isn't accidentally already correct */
    if (order.every((v, i) => v === q.items[i]) && order.length > 1) {
      order = [...order.slice(1), order[0]];
    }
    const list = h('ol', { class: 'ord' });

    function paint() {
      list.textContent = '';
      order.forEach((txt, i) => {
        const up = h('button', { type: 'button', title: 'Move up', disabled: i === 0 || null,
          onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; paint(); onChange(); } }, '▲');
        const dn = h('button', { type: 'button', title: 'Move down', disabled: i === order.length - 1 || null,
          onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; paint(); onChange(); } }, '▼');
        list.append(h('li', {},
          h('span', { class: 'n' }, i + 1),
          h('span', { class: 'txt' }, txt),
          h('span', { class: 'mv' }, up, dn)));
      });
    }
    paint();

    return {
      el: h('div', {},
        h('div', { class: 'muted', style: 'margin:-4px 0 10px' }, 'Use the arrows to put these in the correct order.'),
        list),
      read: () => order.slice(),
      showResult() {
        [...list.children].forEach((li, i) => {
          li.classList.add(order[i] === q.items[i] ? 'right' : 'wrong');
          li.querySelectorAll('button').forEach(b => b.disabled = true);
          if (order[i] !== q.items[i]) {
            li.querySelector('.txt').append(
              h('small', { style: 'display:block;color:var(--accent);margin-top:3px' },
                `correct position: ${q.items.indexOf(order[i]) + 1}`));
          }
        });
      },
    };
  }

  function renderMatch(q, onChange) {
    /* unique right-hand values, shuffled — duplicates collapse to one option
       and may legitimately be chosen for more than one row */
    const opts = SRS.shuffle([...new Set(q.pairs.map(p => p[1]))]);
    const rows = q.pairs.map(p => {
      const sel = h('select', { onchange: onChange },
        h('option', { value: '' }, 'Choose…'),
        opts.map(o => h('option', { value: o }, o)));
      return { row: h('div', { class: 'mrow' }, h('span', { class: 'ml' }, p[0]), sel), sel, pair: p };
    });
    return {
      el: h('div', {},
        h('div', { class: 'muted', style: 'margin:-4px 0 10px' }, 'Pick the match for each row.'),
        rows.map(r => r.row)),
      read: () => rows.every(r => r.sel.value) ? rows.map(r => r.sel.value) : null,
      showResult() {
        rows.forEach(r => {
          r.sel.disabled = true;
          const ok = r.sel.value === r.pair[1];
          r.row.classList.add(ok ? 'right' : 'wrong');
          if (!ok) r.row.querySelector('.ml').append(
            h('span', { class: 'fix' }, `→ ${r.pair[1]}`));
        });
      },
    };
  }

  function renderFill(q, onChange) {
    const input = h('input', {
      class: 'answer-in', type: 'text', autocomplete: 'off',
      autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      placeholder: 'Type your answer', oninput: onChange,
    });
    return {
      el: h('div', {}, input),
      read: () => (input.value.trim() ? input.value : null),
      focus: () => input.focus(),
      showResult(ok) {
        input.disabled = true;
        input.classList.add(ok ? 'right' : 'wrong');
      },
    };
  }

  function renderNumeric(q, onChange) {
    const input = h('input', {
      class: 'answer-in', type: 'text', inputmode: 'decimal',
      autocomplete: 'off', placeholder: '0', oninput: onChange,
    });
    const wrap = h('div', { class: 'unit-wrap' }, input);
    if (q.unit) wrap.append(h('span', { class: 'unit' }, q.unit === '$' ? 'dollars' : q.unit));
    return {
      el: h('div', {}, wrap,
        q.tol > 0 ? h('div', { class: 'muted', style: 'margin-top:8px;text-align:center' },
          `Within ${q.tol} is accepted.`) : null),
      read: () => (input.value.trim() ? input.value : null),
      focus: () => input.focus(),
      showResult(ok) {
        input.disabled = true;
        input.classList.add(ok ? 'right' : 'wrong');
      },
    };
  }

  function render(q, onChange) {
    switch (q.type) {
      case 'mc':      return renderMC(q, onChange);
      case 'tf':      return renderTF(q, onChange);
      case 'multi':   return renderMulti(q, onChange);
      case 'order':   return renderOrder(q, onChange);
      case 'match':   return renderMatch(q, onChange);
      case 'fill':    return renderFill(q, onChange);
      case 'numeric': return renderNumeric(q, onChange);
      default:        return { el: h('div', {}, 'Unsupported question type.'), read: () => null, showResult(){} };
    }
  }

  const TYPE_LABEL = {
    mc:'Multiple choice', tf:'True / false', multi:'Select all',
    order:'Put in order', match:'Matching', fill:'Type the answer', numeric:'Calculation',
  };

  return { h, render, check, answerText, norm, TYPE_LABEL };
})();
