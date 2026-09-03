// Reproduces the numbers in README.md. Needs GROQ_API_KEY and network access.
//   GROQ_API_KEY=... node measure.mjs [runsPerSector]
// Writes results.json and refreshes demo/<sector>.json from run 1 of each sector.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { retrieve, verifyDraft, BLOCKING, STATUS } from './engine.js';
import { SECTORS } from './sectors.js';
import { SYSTEM, userPrompt } from './prompt.js';

const { sources } = JSON.parse(readFileSync('./corpus.json', 'utf8'));
const RUNS = Number(process.argv[2] || 2);
const MODEL = 'openai/gpt-oss-120b';
mkdirSync('demo', { recursive: true });

// Groq's free tier is 8000 tokens/minute and each run costs ~2900. Pace accordingly.
const PACE_MS = 22000;

async function call(prompt) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: MODEL, temperature: 0.3, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return { draft: JSON.parse(j.choices[0].message.content), usage: j.usage };
}

const runs = [], caught = [];
for (const [key, s] of Object.entries(SECTORS)) {
  const r = retrieve(sources, { sector: key, rfpText: s.rfp });
  const prompt = userPrompt(s.rfp, key, r.used);
  for (let i = 0; i < RUNS; i++) {
    await new Promise((res) => setTimeout(res, PACE_MS));
    const { draft, usage } = await call(prompt);
    if (i === 0) writeFileSync(`demo/${key}.json`, JSON.stringify({ ...draft, model: `${MODEL} (Groq)` }, null, 1));
    const v = verifyDraft(draft, sources, s.rfp);
    const all = v.sections.flatMap((x) => x.claims);
    const exc = all.filter((c) => BLOCKING.includes(c.status));
    runs.push({ sector: key, run: i + 1, matched: r.matched.length, eligible: r.eligible.length, used: r.used.length,
      claims: all.length, ...v.counts, exceptions: exc.length, blocked: v.blocked, tokens: usage.total_tokens });
    exc.forEach((c) => caught.push({ sector: key, run: i + 1, status: c.status, text: c.text, cited: c.sourceIds, reason: c.reason }));
    console.log(key, 'run', i + 1, '-', all.length, 'claims,', exc.length, 'exceptions');
  }
}

console.table(runs);
const sum = (f) => runs.reduce((a, b) => a + (b[f] || 0), 0);
const totals = { model: MODEL, runs: runs.length, claims: sum('claims'),
  Grounded: sum(STATUS.GROUNDED), Partial: sum(STATUS.PARTIAL), Unsupported: sum(STATUS.UNSUPPORTED),
  Conflicting: sum(STATUS.CONFLICTING), Judgment: sum(STATUS.JUDGMENT), FromBrief: sum(STATUS.BRIEF),
  exceptions: sum('exceptions'), runsBlocked: runs.filter((r) => r.blocked).length };
console.log('\nTOTALS', totals);
writeFileSync('results.json', JSON.stringify({ totals, runs, caught }, null, 1));
console.log('\n--- EVERY EXCEPTION CAUGHT ---');
caught.forEach((c) => console.log(`[${c.status}] (${c.sector} r${c.run}) ${c.text}\n   ${c.reason}\n`));
