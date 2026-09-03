// One runnable check. Fails loudly if the verification rules break.
// Run: node test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { retrieve, verifyClaim, verifyDraft, STATUS, BLOCKING } from './engine.js';

const { sources } = JSON.parse(readFileSync('./corpus.json', 'utf8'));
const st = (text, sourceIds, type = 'fact') => verifyClaim({ text, sourceIds, type }, sources).status;

// --- verification rules
assert.equal(st('VCG operates across 12 markets.', ['C-001']), STATUS.GROUNDED);
assert.equal(st('VCG operates across 40 markets.', ['C-001']), STATUS.CONFLICTING); // contradicts the record
assert.equal(st('VCG ran 47 workshops for this client.', ['C-001']), STATUS.UNSUPPORTED); // figure simply absent
assert.equal(st('VCG operates across 12 markets.', ['C-001', 'P-2023-044']), STATUS.CONFLICTING);
assert.equal(st('Outbound logistics cost fell 14 percent across 22 sites.', ['P-2024-017']), STATUS.PARTIAL);
assert.equal(st('VCG is uniquely placed to lead this programme.', ['C-001'], 'judgment'), STATUS.JUDGMENT);
assert.equal(st('Some claim.', []), STATUS.UNSUPPORTED);
assert.equal(st('Deployment frequency rose from monthly to weekly.', ['CS-014']), STATUS.GROUNDED);

// Judgment must never block a release.
assert.ok(!BLOCKING.includes(STATUS.JUDGMENT));
assert.ok(!BLOCKING.includes(STATUS.GROUNDED));

// --- retrieval: eligibility is filtered BEFORE the model sees anything
const r = retrieve(sources, { sector: 'supply-chain', rfpText: 'distribution network redesign and supplier risk across regional centres' });
assert.ok(r.matched.length > r.eligible.length, 'restricted/internal sources must be filtered out');
assert.ok(r.eligible.every((s) => s.eligibility === 'approved'));
assert.ok(!r.used.some((s) => s.id === 'X-009'), 'restricted source must never reach the model');
assert.ok(r.excluded.some((e) => e.reason.startsWith('Restricted')));

// --- draft-level gating
const draft = { sections: [{ heading: 'Approach', claims: [
  { text: 'VCG operates across 12 markets.', sourceIds: ['C-001'], type: 'fact' },
  { text: 'We will halve your cost base in 3 weeks.', sourceIds: [], type: 'fact' },
]}]};
const v = verifyDraft(draft, sources);
assert.equal(v.blocked, true, 'an unsupported claim must block approval');
assert.equal(v.counts[STATUS.UNSUPPORTED], 1);

console.log('ok - all verification and retrieval checks passed');
console.log(`matched ${r.matched.length} -> eligible ${r.eligible.length} -> used ${r.used.length}`);

// --- regression: two figures inside ONE source are not a conflict (11 months vs 9 months)
assert.equal(
  st('VCG redesigned the network across 4 centres, cutting cost 14 percent within 11 months.', ['P-2024-017']),
  STATUS.GROUNDED, 'two different figures in the same source must not read as a conflict');

// --- regression: restating the client brief is not a hallucination
assert.equal(st('The client seeks a partner to redesign its distribution network.', [], 'brief'), STATUS.BRIEF);
assert.ok(!BLOCKING.includes(STATUS.BRIEF), 'the client’s own words must never block release');

// --- regression: a claim that contradicts the firm facts of record is a conflict
// even when the model cited only the source that agreed with it.
assert.equal(st('Leveraging our presence in 14 markets, VCG mobilises quickly.', ['P-2023-044']), STATUS.CONFLICTING);
assert.equal(st('VCG operates across 12 markets.', ['C-001']), STATUS.GROUNDED);
// ...and an engagement duration is NOT a firm fact, so it must not false-positive.
assert.equal(st('The engagement ran 7 months with a 5 person team.', ['P-2023-088']), STATUS.GROUNDED);
