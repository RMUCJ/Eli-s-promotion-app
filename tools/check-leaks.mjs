/* =============================================================================
   check-leaks.mjs — refuse to ship the things that must never be committed
   -----------------------------------------------------------------------------
   Run:  node tools/check-leaks.mjs

   The privacy model rests on two facts: the key is not in the repository, and
   the study content in the repository is ciphertext. Both are one careless
   commit away from being false, and a leaked secret stays leaked even if the
   next commit deletes it. So this is checked mechanically, not remembered.

   Note the deliberate absence of a hardcoded list of "sensitive strings". A
   checker that names the terms it is protecting leaks them itself — a real
   mistake made in an earlier version of this file. Instead, when the local
   plaintext is present, distinctive passages are sampled from it at random
   and every tracked file is checked for them. The checker therefore contains
   no secret of its own, and it protects whatever the plaintext actually says
   rather than whatever someone remembered to list.

   Checks
     1. no file that must stay local is tracked by git
     2. the key from .key appears in no tracked file
     3. no passage sampled from the local plaintext appears in a tracked file
     4. the sealed bundle actually looks like ciphertext
   ========================================================================== */

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];

const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
  .split('\n').map(s => s.trim()).filter(Boolean);

const readTracked = f => {
  try { return readFileSync(join(ROOT, f), 'utf8'); } catch { return null; }
};

/* ---- 1. files that must never be tracked -------------------------------- */
const LOCAL_ONLY = [
  '.key',
  'data/questions.js',
  'tools/source-text.txt',
  'docs/notes.md',
];
for (const f of LOCAL_ONLY) {
  if (tracked.includes(f)) fail.push(`"${f}" is tracked by git and must not be`);
}

/* ---- 2. the key must appear in no tracked file -------------------------- */
const keyPath = join(ROOT, '.key');
if (existsSync(keyPath)) {
  const key = readFileSync(keyPath, 'utf8').trim();
  if (key.length >= 20) {
    for (const f of tracked) {
      const body = readTracked(f);
      if (body?.includes(key)) fail.push(`the decryption key appears in tracked file "${f}"`);
    }
  }
}

/* ---- 3. sampled plaintext must appear in no tracked file ---------------- */
/* Deterministic sampling (fixed seed) so CI and local runs agree. */
function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const plaintextSources = [
  'data/questions.js',
  'tools/source-text.txt',
  'docs/notes.md',
].filter(f => existsSync(join(ROOT, f)));

let sampled = 0;
if (plaintextSources.length) {
  const rand = mulberry32(20260916);
  const WINDOW = 48;      // long enough to be unmistakably a copied passage
  const SAMPLES = 400;

  /* A probe must read as prose. Random windows over a .js file otherwise land
     on shared scaffolding ("difficulty:2, prompt:", a rule of dashes) which
     appears in every source file and reports a leak that is not one. */
  const isProse = p =>
    (p.match(/\b[A-Za-z][a-z]{2,}\b/g) || []).length >= 6 &&   // real words
    !/(.)\1{3,}/.test(p) &&                                    // no ==== rules
    (p.match(/[A-Za-z ]/g) || []).length / p.length > 0.8;      // mostly letters

  const probes = new Set();
  for (const src of plaintextSources) {
    /* Collapse whitespace so reformatting cannot hide a copied passage. */
    const text = readFileSync(join(ROOT, src), 'utf8').replace(/\s+/g, ' ');
    if (text.length < WINDOW * 2) continue;
    for (let i = 0; i < SAMPLES; i++) {
      const at = Math.floor(rand() * (text.length - WINDOW));
      const probe = text.slice(at, at + WINDOW).trim();
      if (probe.length >= WINDOW - 4 && isProse(probe)) probes.add(probe);
    }
  }
  sampled = probes.size;
  if (sampled < 50) fail.push(`only ${sampled} usable plaintext probes — sampling is not covering the content`);

  for (const f of tracked) {
    const body = readTracked(f);
    if (body === null) continue;
    const flat = body.replace(/\s+/g, ' ');
    for (const probe of probes) {
      if (flat.includes(probe)) {
        fail.push(`a passage from the study plaintext appears in tracked file "${f}"`);
        break;                                   // one report per file is enough
      }
    }
  }
} else {
  console.log('  note: no local plaintext present — skipping passage sampling');
}

/* ---- 4. the sealed bundle must look sealed ------------------------------ */
const sealedPath = join(ROOT, 'data/bank.enc.js');
if (!existsSync(sealedPath)) {
  fail.push('data/bank.enc.js is missing — run: node tools/seal.mjs seal');
} else {
  const w = {};
  try { new Function('window', readFileSync(sealedPath, 'utf8'))(w); }
  catch { fail.push('data/bank.enc.js does not parse'); }
  const s = w.SEALED_BANK;
  if (!s || s.alg !== 'AES-GCM' || !s.iv || !s.ct)
    fail.push('data/bank.enc.js is not a well-formed sealed bundle');
  else if (s.ct.length < 1000)
    fail.push('sealed ciphertext is suspiciously small');
}

/* ---- report ------------------------------------------------------------- */
if (fail.length) {
  console.log('\n  ✗ LEAK CHECK FAILED\n');
  for (const f of [...new Set(fail)]) console.log('    - ' + f);
  console.log('\n  Do not push until these are resolved. If a secret was already');
  console.log('  pushed, rotate the key and rewrite history — deleting it in a');
  console.log('  later commit does not unpublish it.\n');
  process.exit(1);
}
console.log(`  ✓ leak check passed — ${tracked.length} tracked files, ${sampled} plaintext passages probed, nothing exposed`);
