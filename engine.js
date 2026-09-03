// Vertex Proposal Intelligence - retrieval + verification engine.
//
// Deliberately NOT an LLM. The model drafts; this file decides what is true.
// Same code runs in the browser (app.js) and in test.mjs.

const STOP = new Set(['about','above','after','again','against','among','around','because','been','before','being','below','between','both','cannot','could','does','doing','down','during','each','from','further','have','having','here','into','more','most','other','over','same','should','such','than','that','their','them','then','there','these','they','this','those','through','under','until','very','were','what','when','where','which','while','with','would','your','will','shall','across','within','client','clients','proposal','vertex','vcg']);

const words = (t) => (t.toLowerCase().match(/[a-z][a-z-]{4,}/g) || []).filter((w) => !STOP.has(w));

// Pairs a number with the word that follows it: "12 markets" -> {n:'12', w:'markets'}.
// This is what makes a 12-vs-14 disagreement detectable without a model.
function numPairs(text) {
  const out = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(?:percent|per cent|%)?\s*([a-zA-Z][a-zA-Z-]*)?/g;
  let m;
  while ((m = re.exec(text))) out.push({ n: m[1].replace(/,/g, ''), w: (m[2] || '').toLowerCase() });
  return out;
}

const hasNumber = (text, n) => numPairs(text).some((p) => p.n === n);

function excerptFor(text, needle) {
  const sentences = String(text).split(/(?<=[.!?])\s+|\n+/);
  return (sentences.find((s) => s.toLowerCase().includes(String(needle).toLowerCase())) || sentences[0] || '').trim();
}

// ---------------------------------------------------------------- retrieval

// Eligibility is applied BEFORE anything reaches the model, not after.
export function retrieve(sources, { sector, rfpText, limit = 5 }) {
  const q = new Set(words(rfpText || ''));
  const scored = sources
    .filter((s) => s.type !== 'rate_card')
    .map((s) => {
      const overlap = words(s.text + ' ' + s.title).filter((w) => q.has(w)).length;
      const score = (s.sectors.includes(sector) ? 3 : 0) + Math.min(overlap, 6) + (s.authority === 1 ? 1 : 0);
      return { source: s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.source.authority - b.source.authority);

  const matched = scored.map((x) => x.source);
  const eligible = matched.filter((s) => s.eligibility === 'approved');
  const used = eligible.slice(0, limit);
  const excluded = matched
    .filter((s) => !used.includes(s))
    .map((s) => ({
      id: s.id,
      title: s.title,
      reason:
        s.eligibility === 'restricted' ? 'Restricted - client has not granted reference rights'
        : s.eligibility === 'internal' ? 'Internal only - not client-referenceable'
        : 'Eligible but ranked below the retrieval cut',
    }));

  return { matched, eligible, used, excluded };
}

// ------------------------------------------------------------- verification

export const STATUS = {
  GROUNDED: 'Grounded',
  PARTIAL: 'Partially Grounded',
  UNSUPPORTED: 'Unsupported',
  JUDGMENT: 'Judgment',
  CONFLICTING: 'Conflicting',
  BRIEF: 'From Brief',
};

// Judgment is honest evaluative language and From Brief is the client's own words.
// Neither is a defect, so neither blocks release.
export const BLOCKING = [STATUS.UNSUPPORTED, STATUS.PARTIAL, STATUS.CONFLICTING];

export function verifyClaim(claim, sources, rfpText = '') {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const cited = (claim.sourceIds || []).map((id) => byId.get(id)).filter(Boolean);

  if (claim.type === 'brief') {
    return {
      status: STATUS.BRIEF,
      reason: "Restates the client's own RFP brief. Not a VCG claim, so there is nothing to ground it against.",
      evidence: rfpText ? [{ sourceId: 'RFP', title: 'Client RFP brief', excerpt: excerptFor(rfpText, words(claim.text)[0] || '') }] : [],
    };
  }
  if (claim.type === 'judgment') {
    return { status: STATUS.JUDGMENT, reason: 'Evaluative statement, not a verifiable fact. Does not block approval.', evidence: [] };
  }
  if (!cited.length) {
    return { status: STATUS.UNSUPPORTED, reason: 'No eligible source was cited for this claim.', evidence: [] };
  }

  const nums = numPairs(claim.text).filter((p) => p.w);
  const evidence = [];

  // Firm facts of record (the credentials library) win over anything a past
  // proposal says. A claim that contradicts them is a conflict even if the model
  // only cited the source that agreed with it - the system never picks a side.
  const recordSource = sources.find((s) => s.firmFacts);
  const record = recordSource ? recordSource.firmFacts : {};
  for (const p of nums) {
    if (record[p.w] && record[p.w] !== p.n) {
      const other = cited.find((s) => hasNumber(s.text, p.n));
      return {
        status: STATUS.CONFLICTING,
        reason: `Conflicts with the firm facts of record: ${recordSource.id} states ${record[p.w]} ${p.w}, this claim states ${p.n}. Requires human resolution - the system will not pick one.`,
        evidence: [
          { sourceId: recordSource.id, title: recordSource.title, excerpt: excerptFor(recordSource.text, record[p.w]) },
          ...(other ? [{ sourceId: other.id, title: other.title, excerpt: excerptFor(other.text, p.n) }] : []),
        ],
      };
    }
  }

  // Conflict requires TWO DIFFERENT sources giving different values for the same noun.
  // One source legitimately containing "11 months" and "9 months" is not a conflict.
  for (const p of nums) {
    const byNum = new Map();
    for (const s of cited) {
      for (const sp of numPairs(s.text)) {
        if (sp.w !== p.w) continue;
        if (!byNum.has(sp.n)) byNum.set(sp.n, new Set());
        byNum.get(sp.n).add(s.id);
      }
    }
    const srcIds = new Set([...byNum.values()].flatMap((set) => [...set]));
    if (byNum.size > 1 && srcIds.size > 1 && byNum.has(p.n)) {
      return {
        status: STATUS.CONFLICTING,
        reason: `Cited sources disagree on "${p.w}": ${[...byNum.keys()].join(' vs ')}. Requires human resolution - the system will not pick one.`,
        evidence: [...byNum.entries()].map(([n, set]) => {
          const s = byId.get([...set][0]);
          return { sourceId: s.id, title: s.title, excerpt: excerptFor(s.text, n) };
        }),
      };
    }
  }

  if (nums.length) {
    const supported = nums.filter((p) => cited.some((s) => hasNumber(s.text, p.n)));
    for (const p of supported) {
      const s = cited.find((x) => hasNumber(x.text, p.n));
      if (!evidence.some((e) => e.sourceId === s.id)) evidence.push({ sourceId: s.id, title: s.title, excerpt: excerptFor(s.text, p.n) });
    }
    const missing = nums.filter((p) => !supported.includes(p)).map((p) => `${p.n} ${p.w}`);
    if (!supported.length) return { status: STATUS.UNSUPPORTED, reason: `Figures not found in any cited source: ${missing.join(', ')}.`, evidence: [] };
    if (missing.length) return { status: STATUS.PARTIAL, reason: `Part of this claim is supported; not found in cited sources: ${missing.join(', ')}.`, evidence };
    return { status: STATUS.GROUNDED, reason: 'Every figure in this claim appears in a cited eligible source.', evidence };
  }

  // No figures: fall back to content-word overlap.
  const cw = new Set(words(claim.text));
  const hits = cited.map((s) => ({ s, n: words(s.text).filter((w) => cw.has(w)).length })).sort((a, b) => b.n - a.n);
  const best = hits[0];
  const ev = [{ sourceId: best.s.id, title: best.s.title, excerpt: excerptFor(best.s.text, words(claim.text)[0] || '') }];
  if (best.n >= 2) return { status: STATUS.GROUNDED, reason: 'Claim restates content present in a cited eligible source.', evidence: ev };
  if (best.n === 1) return { status: STATUS.PARTIAL, reason: 'Only weakly supported by the cited source. Confirm before sending.', evidence: ev };
  return { status: STATUS.UNSUPPORTED, reason: 'Cited source does not discuss this claim.', evidence: [] };
}

export function verifyDraft(draft, sources, rfpText = '') {
  const sections = draft.sections.map((sec) => ({
    ...sec,
    claims: sec.claims.map((c) => ({ ...c, ...verifyClaim(c, sources, rfpText) })),
  }));
  const all = sections.flatMap((s) => s.claims);
  const counts = Object.fromEntries(Object.values(STATUS).map((s) => [s, all.filter((c) => c.status === s).length]));
  return { sections, counts, blocked: all.some((c) => BLOCKING.includes(c.status) && !c.resolved) };
}
