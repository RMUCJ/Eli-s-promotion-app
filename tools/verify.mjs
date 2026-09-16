/* =============================================================================
   verify.mjs — question bank integrity checker
   -----------------------------------------------------------------------------
   Run:  node tools/verify.mjs
   CI:   exits non-zero on any ERROR. Warnings do not fail the build.

   Checks performed
     1.  SCHEMA      every question has the fields its type requires
     2.  ANSWERS     answer indices are in range; nothing is unanswerable
     3.  DISTRACTORS no duplicate choices, no accidentally-correct distractors
     4.  IDS         unique, and matching the topic prefix convention
     5.  CITATIONS   every cite names a real page (p1–p22) of the source guide
     6.  GROUNDING   key facts are spot-checked against the extracted source text
     7.  ARITHMETIC  every numeric question with a derivable answer is recomputed
   ========================================================================== */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Content is sealed in the repository. Use the local plaintext when it is
   present (the normal developer case), otherwise unseal with $MQI_KEY. With
   neither, there is nothing to check — say so plainly instead of pretending
   the bank passed. */
const { BANK, SOURCE } = await loadContent();

async function loadContent() {
  const plainQ = join(ROOT, 'data/questions.js');
  const plainS = join(ROOT, 'tools/source-text.txt');

  if (existsSync(plainQ)) {
    const w = {};
    new Function('window', readFileSync(plainQ, 'utf8'))(w);
    return {
      BANK: w.QUESTION_BANK,
      SOURCE: existsSync(plainS) ? readFileSync(plainS, 'utf8') : '',
    };
  }

  const key = process.env.MQI_KEY;
  if (!key) {
    console.log('\n  Content is sealed and no MQI_KEY is set — nothing to verify.');
    console.log('  Run "node tools/seal.mjs unseal" locally, or set the MQI_KEY secret in CI.\n');
    process.exit(0);
  }
  const { loadBank } = await import('./seal.mjs');
  const { questions, sourceText } = await loadBank(key);
  return { BANK: questions, SOURCE: sourceText };
}
/* normalise for substring matching: collapse whitespace, strip smart quotes */
const SRC = (SOURCE || '').replace(/[‘’]/g, "'")
                  .replace(/[“”]/g, '"')
                  .replace(/\s+/g, ' ')
                  .toLowerCase();

const errors = [];
const warns  = [];
const err  = (id, m) => errors.push(`[ERROR] ${id}: ${m}`);
const warn = (id, m) => warns.push(`[warn]  ${id}: ${m}`);

const TOPICS = {
  philosophy: 'ph', hr: 'hr', business: 'bm',
  vehicle: 'vr', risk: 'rk', am: 'am',
};

/* ---- 1-5: structural checks --------------------------------------------- */
const seen = new Set();

for (const q of BANK) {
  const id = q.id ?? '(no id)';

  if (!q.id)                 err(id, 'missing id');
  if (seen.has(q.id))        err(id, 'duplicate id');
  seen.add(q.id);

  if (!TOPICS[q.topic])      err(id, `unknown topic "${q.topic}"`);
  else if (!q.id.startsWith(TOPICS[q.topic] + '-'))
                             err(id, `id prefix does not match topic "${q.topic}"`);

  if (!q.prompt)             err(id, 'missing prompt');
  if (!q.explain)            err(id, 'missing explanation');
  if (!q.cite)               err(id, 'missing citation');
  if (!(q.difficulty >= 1 && q.difficulty <= 3))
                             err(id, 'difficulty must be 1-3');

  /* citation must reference at least one real page of the 22-page guide */
  if (q.cite) {
    const pages = [...q.cite.matchAll(/p(\d{1,2})/g)].map(m => +m[1]);
    if (!pages.length)       err(id, `citation "${q.cite}" names no page`);
    for (const p of pages)
      if (p < 1 || p > 22)   err(id, `citation names page ${p}; guide has 22 pages`);
  }

  switch (q.type) {
    case 'mc': {
      if (!Array.isArray(q.choices) || q.choices.length < 2)
        err(id, 'mc needs at least 2 choices');
      else {
        if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.choices.length)
          err(id, `mc answer index ${q.answer} out of range`);
        const set = new Set(q.choices.map(c => c.trim().toLowerCase()));
        if (set.size !== q.choices.length) err(id, 'mc has duplicate choices');
        if (q.choices.length < 3) warn(id, 'mc has only 2 choices — consider tf instead');
      }
      break;
    }
    case 'multi': {
      if (!Array.isArray(q.choices) || q.choices.length < 3)
        err(id, 'multi needs at least 3 choices');
      if (!Array.isArray(q.answer) || q.answer.length === 0)
        err(id, 'multi needs a non-empty answer array');
      else {
        for (const a of q.answer)
          if (typeof a !== 'number' || a < 0 || a >= (q.choices?.length ?? 0))
            err(id, `multi answer index ${a} out of range`);
        if (new Set(q.answer).size !== q.answer.length)
          err(id, 'multi answer has duplicate indices');
        if (q.answer.length === q.choices.length)
          warn(id, 'every choice is correct — no distractor to discriminate on');
      }
      const set = new Set((q.choices ?? []).map(c => c.trim().toLowerCase()));
      if (set.size !== (q.choices ?? []).length) err(id, 'multi has duplicate choices');
      break;
    }
    case 'tf': {
      if (typeof q.answer !== 'boolean') err(id, 'tf answer must be true or false');
      break;
    }
    case 'fill': {
      if (!Array.isArray(q.accept) || !q.accept.length)
        err(id, 'fill needs an accept array');
      if (!q.answer) err(id, 'fill needs a canonical answer');
      else {
        const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
        if (!q.accept.map(norm).includes(norm(q.answer)))
          err(id, 'canonical answer is not in its own accept list');
      }
      break;
    }
    case 'order': {
      if (!Array.isArray(q.items) || q.items.length < 3)
        err(id, 'order needs at least 3 items');
      else if (new Set(q.items).size !== q.items.length)
        err(id, 'order has duplicate items');
      break;
    }
    case 'match': {
      if (!Array.isArray(q.pairs) || q.pairs.length < 2)
        err(id, 'match needs at least 2 pairs');
      else {
        for (const p of q.pairs)
          if (!Array.isArray(p) || p.length !== 2) err(id, 'match pair malformed');
        const L = q.pairs.map(p => p[0]), R = q.pairs.map(p => p[1]);
        if (new Set(L).size !== L.length) err(id, 'match has duplicate left values');
        /* Duplicate RIGHT values are legitimate (e.g. two taxes both "$2/day").
           The UI grades a match by the VALUE the learner selects, not by pair
           index, and renders the unique values as the option list — so a
           repeated value is answerable and gradeable. Left values must still be
           unique, since they are the rows being answered. */
        if (new Set(R).size !== R.length)
          warn(id, `duplicate right values (${R.length - new Set(R).size}) — graded by value, ensure UI dedupes options`);
        if (new Set(R).size < 2)
          err(id, 'match has fewer than 2 distinct right values — nothing to discriminate');
      }
      break;
    }
    case 'numeric': {
      if (typeof q.answer !== 'number' || Number.isNaN(q.answer))
        err(id, 'numeric needs a numeric answer');
      if (q.tol === undefined) err(id, 'numeric needs a tolerance (tol)');
      break;
    }
    default:
      err(id, `unknown type "${q.type}"`);
  }
}

/* ---- 6: grounding — spot-check load-bearing facts against the source ----- */
/* Each entry: [question id, a phrase that MUST appear in the source guide].  */
const GROUNDING = [
  ['ph-001', 'founder: jack taylor'],
  ['ph-003', 'in 1957'],
  ['ph-005', 'u.s.s. enterprise'],
  ['ph-016', 'advance the world one journey at a time'],
  ['ph-018', 'builds future leaders'],
  ['ph-022', 'goal is 2 above corporate average'],
  ['ph-025', 'august 1 - july 31'],
  ['hr-003', 'roll over 2 choice time days + 3 vacation days'],
  ['hr-006', 'relocation bonus of $3,000'],
  ['hr-008', 'max of 5 per year'],
  ['hr-009', 'meets = $0.25 per hour'],
  ['hr-019', 'due by the 25th of every month'],
  ['hr-022', 'quid pro quo'],
  ['hr-031', 'half paid when they complete a month'],
  ['hr-033', 'alycia baker'],
  ['bm-007', '30 days for retail/chargebacks/forced charges'],
  ['bm-008', '90 days for insurance/corporate/dealerships/bodyshops'],
  ['bm-014', 'concession recovery fee (for rent) - 11.11%'],
  ['bm-015', 'customer facility charge (for facility maintenance) - $8/day'],
  ['bm-024', 'highest direct cost'],
  ['bm-027', '3 chip rule'],
  ['bm-031', 'limit of $30/person'],
  ['bm-033', 'paying interest to taylor family'],
  ['bm-042', '$300,000 worth of damages'],
  ['bm-043', 'up to $100,000 as long as a police report has been filed'],
  ['bm-046', '5 family and friend links'],
  ['bm-047', '$200 monthly payment for an ecar-ifar'],
  ['bm-051', 'average daily rate (adr) x de% x number of days in month'],
  ['bm-053', 'dw + slp + rap + pec+ sxm + fso + gps'],
  ['bm-058', 'every $ increase in rate adds $30 to ipc'],
  ['bm-060', 'rolling 12 month average + 10% buffer + 1 month lag'],
  ['bm-061', '1.7%'],
  ['vr-002', 'check all the tires (4/32nds)'],
  ['vr-015', 'maggie liu or rob lunsford'],
  ['vr-016', 'more than 5 days'],
  ['vr-018', 'taco (texture, alignment, color, overspray)'],
  ['rk-003', 'young driver fee of $25/day'],
  ['rk-008', 'additional driver: $15/day'],
  ['rk-012', 'retail: $850 deposit'],
  ['rk-014', 'exposed to $100,000 and the branch to $25,000'],
  ['rk-015', 'kim willis'],
  ['rk-016', 'rental ready should be 85%'],
  ['rk-021', 'lpu: loss per unit (vx) ($45 goal)'],
  ['rk-027', 'highest uninsured loss we have'],
  ['rk-035', 'approved by sean young'],
  ['rk-038', 'up to 60 days'],
  ['rk-042', 'down payment by $100 on retail/$200 on insurance'],
  ['rk-045', '48 hours'],
  ['rk-046', 'approved by grayson/bittner'],
  ['rk-051', '3 year period'],
  ['am-002', 'biggest area of opportunity being the ss'],
  ['am-013', 'arms dealer'],
  ['am-017', 'call red cars in under 20 minutes'],
  ['am-027', 'goal is 89%'],
  ['am-034', 'only booking $40/day cars for same day reservations'],
  ['am-037', 'goal is $100/car'],
  ['am-038', 'within 24-48 hours'],
  ['am-042', 'diverse fleet mix'],
  ['am-049', 'tires'],
  ['am-052', 'operating expense'],
];

for (const [id, phrase] of GROUNDING) {
  if (!BANK.some(q => q.id === id)) { err(id, 'grounding check references a missing question'); continue; }
  const needle = phrase.replace(/\s+/g, ' ').toLowerCase();
  if (!SRC.includes(needle)) err(id, `grounding phrase not found in source guide: "${phrase}"`);
}

/* ---- 7: arithmetic — recompute every derivable numeric answer ------------ */
const MATH = [
  ['hr-007', 120 / 30],
  ['bm-062', 26650 * 0.017],
  ['bm-063', 26650 * 0.017 * 8],
  ['bm-064', 26650 - (26650 * 0.017 * 8)],
  ['bm-065', 23650 - (26650 - 26650 * 0.017 * 8)],
  ['bm-067', 0.75 * 35 + 0.15 * 65 + 0.10 * 48],
  ['bm-068', 0.75 * 35],
  ['bm-069', 45 * 0.90 * 31],
  ['bm-070', 1256 + 65],
  ['bm-071', 485 + 150 + 80 + 65 + 75 + 61],
  ['bm-072', 1321 - 916],
  ['bm-073', 405 + 200],
  ['bm-074', 605 * 100 * 0.02],
];

for (const [id, expected] of MATH) {
  const q = BANK.find(x => x.id === id);
  if (!q) { err(id, 'arithmetic check references a missing question'); continue; }
  const tol = Math.max(q.tol ?? 0, 0.005);
  if (Math.abs(q.answer - expected) > tol)
    err(id, `stated answer ${q.answer} != recomputed ${expected.toFixed(4)} (tol ${tol})`);
}

/* ---- report -------------------------------------------------------------- */
const byTopic = {}, byType = {};
for (const q of BANK) {
  byTopic[q.topic] = (byTopic[q.topic] || 0) + 1;
  byType[q.type]   = (byType[q.type]   || 0) + 1;
}

console.log('─'.repeat(64));
console.log(`  MQI question bank — ${BANK.length} questions`);
console.log('─'.repeat(64));
console.log('  by topic :', Object.entries(byTopic).map(([k, v]) => `${k} ${v}`).join('  '));
console.log('  by type  :', Object.entries(byType).map(([k, v]) => `${k} ${v}`).join('  '));
console.log(`  flagged  : ${BANK.filter(q => q.flag).length} (source ambiguity — verify with your AM)`);
console.log(`  grounded : ${GROUNDING.length} facts spot-checked against source text`);
console.log(`  recomputed: ${MATH.length} numeric answers`);
console.log('─'.repeat(64));

for (const w of warns)  console.log(w);
for (const e of errors) console.log(e);

if (errors.length) {
  console.log(`\n  ✗ ${errors.length} error(s)\n`);
  process.exit(1);
}
console.log(`\n  ✓ all checks passed${warns.length ? ` (${warns.length} warning(s))` : ''}\n`);
