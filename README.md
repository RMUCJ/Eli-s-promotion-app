# MQI Prep — Group 40

A mobile-first test prep app for the **Management Qualification Interview (MQI)**, built from the 22-page Group 40 MQI Study Guide.

**282 questions · 7 question types · spaced repetition · progress saved per person**

---

## Opening the app

The app is **locked**. The study content is encrypted with AES-256-GCM, and the key travels in the link after the `#`. Browsers never transmit a URL fragment, so the key never reaches GitHub or any other server — the link itself is the credential.

Once Pages is switched on (see [Setup](#setup-github-pages)), the study link is:

```
https://rmucj.github.io/Eli-s-promotion-app/#k=<your-key>
```

The real key is **deliberately not written down in this repository** — publishing it here would defeat the encryption entirely. It was handed over out of band. Run `node tools/seal.mjs link` on the machine holding `.key` to print the full study link again.

**Save that link somewhere you will not lose it.** There is no recovery: the key exists only in that link and in the gitignored `.key` file. Lose both and nobody can decrypt the content — not you, not me.

Open it on a phone and use **Share -> Add to Home Screen**. The key is remembered on that device, so the full link is only needed once per phone. Anyone who opens the bare URL without the key gets a lock screen and nothing else.

To revoke access on one device: **Settings -> Lock this device**. To revoke it everywhere, rotate the key (below) — every old link stops working.

---

## What it does

### Reinforced learning, not a quiz you can pass by luck

The app uses a **Leitner box system**. Every question sits in a box from 0 to 6:

- Get it **right** → it moves up a box and goes quiet for longer: 1, 2, 4, 8, 16, then 32 days.
- Get it **wrong** → it drops straight back to **box 0**, comes back *within the same session* three questions later, and is due again immediately.

The practical effect is that **you cannot finish a session while still getting something wrong**. Material you know fades into the background so your time goes to material you don't. A question counts as *mastered* at box 4 — roughly, you've got it right four times across widening gaps.

### Six study modes

| Mode | What it does |
|---|---|
| **Daily Review** | The adaptive queue. Overdue cards first, then new material, then a top-up. This is the one to use most days. |
| **Study by Topic** | Drill a single section — useful when your AM says "read up on risk management." |
| **Weak Spots** | Only the questions you keep missing, lowest box first. |
| **Exam Simulation** | 20/40/60 questions spread evenly across all six topics, timed, no feedback until the end. |
| **Progress** | Mastery per topic, accuracy, day streak, exam history. |
| **Verify With Your AM** | The 7 places the study guide contradicts itself — see below. |

### Seven question types

Multiple choice · Select-all-that-apply · True/false · Type-the-answer · Put-in-order · Matching · Calculation

The calculation questions are the real income-statement and FLIP problems from pages 11–12, broken into steps so you learn the chain rather than memorising one answer.

### Sign-in

Pick a name, set a 4-digit PIN. Progress, scores and review schedule are saved per profile.

> **Be clear about what the PIN is.** It separates profiles on a shared device. It is **not** security. Everything is stored in this browser's `localStorage` — anyone with access to the unlocked device could read it, and there is no server, no account, and no password recovery. It is a "who's studying" switch, nothing more.
>
> Because there is no server, progress does **not** sync between your phone and your laptop. Use **Settings → Export** to save a backup file and **Import** it on the other device. Export before clearing your browser data, or the progress is gone.

---

## Are the questions correct?

Every question carries a **citation** to the page and section of the study guide it came from — shown under the explanation each time you answer. Nothing was invented.

Correctness is enforced by an automated checker, not by trust:

```bash
node tools/verify.mjs
```

It runs on every push (see `.github/workflows/verify.yml`) and checks:

1. **Schema** — every question has the fields its type requires
2. **Answers** — every answer index is in range; nothing is unanswerable
3. **Distractors** — no duplicate choices; matching questions can be graded unambiguously
4. **IDs** — unique, and consistent with the topic prefix
5. **Citations** — every citation names a real page (1–22) of the guide
6. **Grounding** — **60 load-bearing facts** are string-matched against the extracted source text in `tools/source-text.txt`. If a number or name in a question doesn't literally appear in the guide, the build fails.
7. **Arithmetic** — all **13** derivable calculation answers are recomputed from scratch and compared to the stated answer

### Where the study guide contradicts itself

Seven items are **flagged in the app** with an amber warning rather than silently "corrected". You are still quizzed on them, using the most defensible reading, but you're told what's unclear so you can confirm with your Area Manager. They are listed in [`docs/SOURCE-NOTES.md`](docs/SOURCE-NOTES.md) and in the app under **Verify With Your AM**.

The most consequential one: **the FLIP formula on p11 contradicts the worked example on p12 and the Depreciation section on p20.** The app uses the worked example (`FLIP = sold price − RBV`), because it's internally consistent and appears twice.

---

## Setup (GitHub Pages)

The app is plain HTML, CSS and JavaScript with **no build step**, so Pages serves it directly.

This is a one-time, three-click step that only a repository owner can do — it can't be done from code.

1. Open **[Settings → Pages](https://github.com/RMUCJ/Eli-s-promotion-app/settings/pages)**
2. Under **Source**, choose **Deploy from a branch**
3. Leave the branch as `claude/promotion-test-prep-app-koldll` (it is this repository's default branch) and the folder as **`/ (root)`**
4. Click **Save**, wait about a minute, then open the link above

Publishing the site makes this repository's contents publicly readable — including the study guide material in `data/questions.js` and `tools/source-text.txt`.

## Running it locally

```bash
git clone https://github.com/RMUCJ/Eli-s-promotion-app.git
cd Eli-s-promotion-app
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly via `file://` mostly works, but serving over HTTP is better — the browser only exposes the `crypto.subtle` API used for PIN hashing on `https://` or `localhost`.

---

## Editing the questions

The questions live in `data/questions.js` — but that file is **encrypted in the repository**, so the cycle is unseal, edit, re-seal:

```
node tools/seal.mjs unseal     # writes data/questions.js in the clear (gitignored)
#   ...edit data/questions.js...
node tools/verify.mjs          # check the edit before committing
node tools/seal.mjs seal       # re-encrypt into data/bank.enc.js
git add data/bank.enc.js && git commit -m "Add questions" && git push
```

Unsealing returns the authored file byte for byte, comments and all. **Never commit `data/questions.js`** — `.gitignore` covers it, so don't force-add it.

It's a plain array — no database, no build tooling. To add a question, copy an existing block and change the fields:

```js
{ id:"rk-061", topic:"risk", type:"mc", difficulty:2,
  prompt:"Your question?",
  choices:["Right answer","Wrong","Wrong","Wrong"],
  answer:0,                                  // index of the correct choice
  explain:"Why it's the answer, and what to remember.",
  cite:"p14 · Underwriting" },                // page + section of the guide
```

Then run `node tools/verify.mjs` before committing. The `id` prefix must match the topic (`ph-` philosophy, `hr-`, `bm-` business, `vr-` vehicle, `rk-` risk, `am-` area manager).

Field reference by type:

| Type | Required fields |
|---|---|
| `mc` | `choices`, `answer` (index) |
| `multi` | `choices`, `answer` (array of indices) |
| `tf` | `answer` (true/false) |
| `fill` | `accept` (array of acceptable strings), `answer` (canonical) |
| `order` | `items` (array **in correct order**) |
| `match` | `pairs` (`[[left, right], …]`) |
| `numeric` | `answer` (number), `tol` (tolerance), optional `unit` |

Add a `flag:"…"` field to any question where the guide is unclear — it renders the amber warning and appears under *Verify With Your AM*.

---

## Project layout

```
index.html              app shell
css/styles.css          mobile-first stylesheet
js/store.js             profiles + progress (localStorage)
js/srs.js               the Leitner spaced-repetition engine
js/quiz.js              renderers and graders for the 7 question types
js/app.js               views, routing, session loop
js/unlock.js            decrypts the content, then starts the app
data/bank.enc.js        the 282 questions, encrypted (this is what is committed)
tools/seal.mjs          seal / unseal / keygen / link
tools/verify.mjs        the correctness checker
tools/test-logic.mjs    903 assertions over the grader and SRS engine
tools/check-leaks.mjs   refuses to ship the key or any plaintext
docs/SOURCE-NOTES.md    the 7 flagged contradictions, in detail

not committed (gitignored, local only):
.key                    the decryption key
data/questions.js       plaintext questions  (node tools/seal.mjs unseal)
tools/source-text.txt   extracted guide text (node tools/seal.mjs unseal)
```

## Privacy — what the encryption does and does not do

No analytics, no trackers, no third-party scripts, no cookies, and the app makes no network requests of its own. Study progress stays in the browser's `localStorage` on the device it was created on.

**What it protects.** `data/bank.enc.js` is AES-256-GCM ciphertext. Anyone browsing this repository, or loading the site without a key, gets that blob and nothing readable. Decryption happens in the browser via the Web Crypto API with a key that arrives in the URL fragment and is never sent over the network. GCM is authenticated, so a wrong key fails cleanly instead of producing garbage.

**What it does not protect.** Anyone you give the link to has the content permanently — they can read it, save it, or forward it. This is link-capability access, not per-person access: there are no accounts to revoke individually. Treat the link exactly as you would treat the study guide PDF.

**Keep it that way.** The plaintext (`data/questions.js`, `tools/source-text.txt`) and the key (`.key`) are gitignored and must stay that way. If either is ever committed, rotate the key and rewrite history — a committed secret is a leaked secret even if the next commit deletes it.

## Rotating the key

If a link leaks, or you want to cut off someone you shared it with:

```
node tools/seal.mjs unseal          # recover plaintext using the current key
rm .key
node tools/seal.mjs keygen          # new key; prints the new study link
node tools/seal.mjs seal            # re-encrypt under the new key
git add data/bank.enc.js && git commit -m "Rotate content key" && git push
```

Every link issued under the old key stops working immediately. Anyone already using the app keeps whatever they have read, but gets a "your saved key no longer works" prompt on their next visit.

## Verifying the questions in CI

The checks can only run against content they can read. To let GitHub Actions verify the sealed bank on every push, add the key as a repository secret:

**Settings -> Secrets and variables -> Actions -> New repository secret**, named `MQI_KEY`, with the key from your study link (the part after `#k=`).

Without that secret the workflow still runs, reports that the content is sealed, and skips the content checks rather than passing them silently. Locally the checks use your unsealed plaintext automatically.
