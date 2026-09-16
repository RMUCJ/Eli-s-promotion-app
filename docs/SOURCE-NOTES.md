# Source notes

> **The detailed notes are not in this repository.** They quote the study guide
> directly — names, figures, exact wording — so they ship inside the encrypted
> bundle instead. Read them in the app under **Verify With Your AM → Read the
> full source notes**, or unseal them locally with `node tools/seal.mjs unseal`
> (they land in `docs/notes.md`, which is gitignored).

This page describes the method only, and deliberately contains no content from
the guide.

## Why flagging, rather than fixing

The question bank is built strictly from a 22-page study guide. In seven places
that guide contradicts itself, repeats itself, or contains an apparent typo.

There were three options for each: drop the item, silently pick an answer, or
flag it. Dropping loses material that may well be asked. Silently picking makes
a judgement call look like a fact, which is the worst outcome for someone
walking into an interview — they would defend a wrong answer with confidence.

So the app does the third thing: it quizzes on the most defensible reading, and
shows an amber warning saying what is uncertain and why. The learner ends up
knowing both the likely answer *and* that it is worth confirming.

## What gets flagged

A question carries a `flag` field when one of these is true of the source:

| Category | What it means |
|---|---|
| **Internal contradiction** | The guide states a rule one way in one place and another way elsewhere. The app follows whichever version is internally consistent and used more than once. |
| **Self-doubt in the source** | The guide's own answer is visibly uncertain — trailing question marks, a placeholder, an unfinished section. |
| **Duplicate definitions** | Two items listed separately carry word-for-word the same wording, so whatever actually separates them went unrecorded. |
| **Apparent typo** | Wording that is grammatically broken or contradicts the surrounding text, where the intended meaning is recoverable. |
| **Incomplete section** | The author left a to-do and an empty table. |

Of the seven flagged items, one matters more than the rest: a formula stated one
way on a summary page and computed a different way in two worked examples. The
app follows the worked examples, because they are arithmetically self-consistent
and appear twice — but a formula you might be asked to recite verbatim is worth
confirming with a manager.

## How flagged items surface

1. **In the question feedback** — an amber panel under the explanation, every
   time the question comes up.
2. **On the question card** — a "⚠ Check w/ AM" pill while answering.
3. **In a dedicated screen** — *Verify With Your AM* lists all seven with the
   answer the app uses and the reason for the flag.
4. **In the session results** — repeated under any flagged question missed.

## Adding a flag

Add a `flag` field to any question in `data/questions.js`. The text should say
what the guide actually prints, what the app assumes instead, and why:

```
flag:"The guide states X on one page but computes Y in its worked example.
      The app follows Y because it is internally consistent. Confirm with your AM."
```

`tools/verify.mjs` counts flagged items on every run so the total never drifts
from what the documentation claims.
