/* =============================================================================
   seal.mjs — encrypt the study content so the repository can hold it publicly
   -----------------------------------------------------------------------------
   The question bank and the extracted guide text are encrypted with AES-256-GCM
   into data/bank.enc.js. That sealed file is what gets committed. The plaintext
   (data/questions.js, tools/source-text.txt) is gitignored and never pushed.

   The key lives in the study link after a '#'. Browsers never transmit the
   fragment, so the key reaches no server — not GitHub's, not anyone's. Without
   it the committed file is ciphertext and nothing more.

   USAGE
     node tools/seal.mjs keygen            make a new key (do this once)
     node tools/seal.mjs seal              encrypt plaintext -> data/bank.enc.js
     node tools/seal.mjs unseal            decrypt data/bank.enc.js -> plaintext
     node tools/seal.mjs link              print the shareable study link

   The key is read from $MQI_KEY, else from the gitignored .key file.
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto as crypto } from 'node:crypto';

const ROOT     = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLAIN_Q  = join(ROOT, 'data/questions.js');
const PLAIN_S  = join(ROOT, 'tools/source-text.txt');
const PLAIN_N  = join(ROOT, 'docs/notes.md');
const SEALED   = join(ROOT, 'data/bank.enc.js');
const KEYFILE  = join(ROOT, '.key');

const SITE = 'https://rmucj.github.io/Eli-s-promotion-app/';

/* ---- base64url (URL-safe, no padding — survives being in a link) --------- */
const b64u = {
  encode: bytes => Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: str => new Uint8Array(Buffer.from(
    str.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
};

function loadKey() {
  const raw = process.env.MQI_KEY
    || (existsSync(KEYFILE) ? readFileSync(KEYFILE, 'utf8').trim() : '');
  if (!raw) {
    console.error('No key found. Set $MQI_KEY, or run: node tools/seal.mjs keygen');
    process.exit(1);
  }
  const bytes = b64u.decode(raw);
  if (bytes.length !== 32) {
    console.error(`Key must decode to 32 bytes, got ${bytes.length}. Is it complete?`);
    process.exit(1);
  }
  return { raw, bytes };
}

const importKey = (bytes, use) =>
  crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [use]);

/* ---- commands ----------------------------------------------------------- */

async function keygen() {
  if (existsSync(KEYFILE)) {
    console.error(`.key already exists — refusing to overwrite it.`);
    console.error(`Delete it deliberately first if you really want a new key.`);
    console.error(`(A new key invalidates every study link already handed out.)`);
    process.exit(1);
  }
  const key = b64u.encode(crypto.getRandomValues(new Uint8Array(32)));
  writeFileSync(KEYFILE, key + '\n');
  console.log('\n  New key written to .key (gitignored — it must never be committed)\n');
  console.log('  Key:  ' + key);
  console.log('\n  Study link:\n  ' + SITE + '#k=' + key + '\n');
}

async function seal() {
  const { bytes } = loadKey();
  if (!existsSync(PLAIN_Q)) {
    console.error('data/questions.js is missing. Run: node tools/seal.mjs unseal');
    process.exit(1);
  }

  /* Seal the FILE TEXT, not the evaluated data, so unsealing hands back the
     authored file byte for byte — comments, section headers and all. */
  const questionsSource = readFileSync(PLAIN_Q, 'utf8');

  const w = {};
  new Function('window', questionsSource)(w);       // validate before sealing
  const questions = w.QUESTION_BANK;
  if (!Array.isArray(questions) || !questions.length) {
    console.error('questions.js did not produce a question bank.');
    process.exit(1);
  }

  const payload = JSON.stringify({
    questionsSource,
    sourceText: existsSync(PLAIN_S) ? readFileSync(PLAIN_S, 'utf8') : '',
    notes:      existsSync(PLAIN_N) ? readFileSync(PLAIN_N, 'utf8') : '',
  });

  const iv = crypto.getRandomValues(new Uint8Array(12));   // fresh IV each seal
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, await importKey(bytes, 'encrypt'),
    new TextEncoder().encode(payload)));

  writeFileSync(SEALED,
`/* Sealed study content — AES-256-GCM.
   Without the key from the study link this file is noise. Do not hand-edit:
   regenerate it with "node tools/seal.mjs seal". */
window.SEALED_BANK = {
  v: 1,
  alg: "AES-GCM",
  iv: "${b64u.encode(iv)}",
  ct: "${b64u.encode(ct)}"
};
`);

  console.log(`  Sealed ${questions.length} questions + ${(payload.length / 1024).toFixed(0)} KB payload`);
  console.log(`  -> data/bank.enc.js (${(ct.length / 1024).toFixed(0)} KB ciphertext)`);
}

async function unseal() {
  const { bytes } = loadKey();
  if (!existsSync(SEALED)) { console.error('data/bank.enc.js is missing.'); process.exit(1); }

  const w = {};
  new Function('window', readFileSync(SEALED, 'utf8'))(w);
  const s = w.SEALED_BANK;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64u.decode(s.iv) },
      await importKey(bytes, 'decrypt'), b64u.decode(s.ct))));
  } catch {
    console.error('Decryption failed — that key does not match this sealed file.');
    process.exit(1);
  }

  writeFileSync(PLAIN_Q, payload.questionsSource);
  if (payload.sourceText) writeFileSync(PLAIN_S, payload.sourceText);
  if (payload.notes)      writeFileSync(PLAIN_N, payload.notes);

  const w2 = {};
  new Function('window', payload.questionsSource)(w2);
  console.log(`  Unsealed ${w2.QUESTION_BANK.length} questions -> data/questions.js`);
  if (payload.sourceText) console.log('  Unsealed guide text -> tools/source-text.txt');
  if (payload.notes)      console.log('  Unsealed study notes -> docs/notes.md');
}

/* Used by verify.mjs and test-logic.mjs so they can check sealed content. */
export async function loadBank(keyRaw) {
  const bytes = b64u.decode(keyRaw);
  const w = {};
  new Function('window', readFileSync(SEALED, 'utf8'))(w);
  const s = w.SEALED_BANK;
  const payload = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64u.decode(s.iv) },
    await importKey(bytes, 'decrypt'), b64u.decode(s.ct))));
  const w2 = {};
  new Function('window', payload.questionsSource)(w2);
  return { questions: w2.QUESTION_BANK, sourceText: payload.sourceText };
}

const CMDS = { keygen, seal, unseal, link: () => {
  const { raw } = loadKey();
  console.log('\n  ' + SITE + '#k=' + raw + '\n');
} };

if (process.argv[1] && process.argv[1].endsWith('seal.mjs')) {
  const cmd = process.argv[2];
  if (!CMDS[cmd]) {
    console.error('Usage: node tools/seal.mjs <keygen|seal|unseal|link>');
    process.exit(1);
  }
  await CMDS[cmd]();
}
