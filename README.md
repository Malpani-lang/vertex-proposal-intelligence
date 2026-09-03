# Vertex Proposal Intelligence

An AI agent that turns a consulting firm's past work into evidence-grounded proposal
drafts, and refuses to let an unverified claim reach a client.

Built for the Bottoms Up 5.0 Round 2 case (Vertex Consulting Group GenAI prioritisation),
as the Proposal Development use case in the recommended PD + PMO + MD portfolio.

**Generate → Prove → Control.**

---

## The design decision that matters

**The model drafts. It does not decide what is true.**

`engine.js` is a deterministic rule engine with no model in it. It takes whatever the
LLM returns and assigns every claim one of six statuses:

| Status | Meaning | Blocks release |
|---|---|---|
| `Grounded` | Every figure appears in a cited eligible source | no |
| `Partially Grounded` | Part of a compound claim is unsupported | **yes** |
| `Unsupported` | No eligible source supports it | **yes** |
| `Conflicting` | Sources materially disagree, or the claim contradicts the firm facts of record | **yes** |
| `Judgment` | Evaluative or prescriptive language, not a checkable fact | no |
| `From Brief` | Restates the client's own RFP | no |

An LLM asked to grade its own output is confident about exactly the things it got wrong.
Verification here is arithmetic and set membership, so the same input always produces the
same verdict.

### Firm facts of record

`C-001` (the credentials library) declares `firmFacts`. A claim contradicting one of them
is `Conflicting` **even when the model cited a source that agrees with it**. This exists
because of the failure mode we actually measured: the model does not usually fabricate
figures — it faithfully copies *stale* ones out of a genuine past proposal. Retrieval
alone can never catch that, because the source really does say it.

### Eligibility runs before generation, not after

`retrieve()` filters `restricted` and `internal` sources out *before* the prompt is built,
so confidential client material is never in the model's context. The UI shows the real
funnel — `12 matched → 9 eligible → 5 used` — and names every source it dropped and why.

---

## Measured behaviour

12 runs across 6 sectors, 239 claims, `openai/gpt-oss-120b` at temperature 0.3
(`results.json`, reproducible via `measure.mjs`):

| | count | share |
|---|---|---|
| Grounded | 146 | 61.1% |
| Judgment | 40 | 16.7% |
| From Brief | 40 | 16.7% |
| **Conflicting** | **7** | **2.9%** |
| **Unsupported** | **4** | **1.7%** |
| **Partially Grounded** | **2** | **0.8%** |

**7 of 12 runs were blocked from release.** Five of the seven conflicts were the same
stale-fact propagation: the model asserting VCG operates in 14 markets, copied verbatim
from a real 2023 proposal, against a credentials library that says 12. Caught every time.

---

## Run it

```
npm test          # node test.mjs - verification and retrieval checks
vercel dev        # or open index.html with any static server + the /api route
```

No build step, no framework, no runtime dependencies.

| file | what it is |
|---|---|
| `index.html` | markup and styles for all three workspaces |
| `app.js` | wiring and rendering |
| `engine.js` | retrieval + verification. The part that decides things. |
| `corpus.json` | 17 synthetic VCG sources with eligibility and authority tags |
| `sectors.js` | six sector presets |
| `api/draft.js` | serverless drafting endpoint (Groq, Gemini fallback) |
| `demo/*.json` | cached real runs, so a dead API cannot kill a live demo |
| `test.mjs` | the checks |
| `measure.mjs` | reproduces the numbers above |

Environment: `GROQ_API_KEY`, `GEMINI_API_KEY`.

---

## What this deliberately is not

Not a chatbot. Not an autonomous agent — a human signs two separate tracks, content and
commercial, and neither is pre-checked. Pricing is retrieved from an approved rate card
and never generated. The agent's job is to make a consultant faster at defending a claim,
not to relieve them of having to.
