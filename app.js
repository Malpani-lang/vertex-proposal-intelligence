import { retrieve, verifyDraft, STATUS, BLOCKING } from './engine.js';
import { SECTORS } from './sectors.js';

const $ = (id) => document.getElementById(id);

let CORPUS = [];
let state = { retrieval: null, verified: null, section: 0, claim: null, resolved: new Set() };

// ---------------------------------------------------------------- boot
const sel = $('sector');
for (const [k, v] of Object.entries(SECTORS)) sel.add(new Option(v.label, k));
sel.value = 'supply-chain';
const loadPreset = () => { const s = SECTORS[sel.value]; $('rfp').value = s.rfp; $('client').value = s.client; };
sel.onchange = loadPreset;
loadPreset();

CORPUS = (await (await fetch('./corpus.json')).json()).sources;
$('rates').innerHTML = CORPUS.find((s) => s.type === 'rate_card').rates
  .map((r) => `<tr><td>${r.grade}</td><td>&#8377;${r.dayRate.toLocaleString('en-IN')}/day</td></tr>`).join('');

// ---------------------------------------------------------------- tabs
const tabs = [$('t0'), $('t1'), $('t2')];
const show = (i) => {
  tabs.forEach((t, j) => t.setAttribute('aria-selected', i === j));
  [0, 1, 2].forEach((j) => $('p' + j).classList.toggle('on', i === j));
  if (i === 2) renderReview();
};
tabs.forEach((t, i) => (t.onclick = () => !t.disabled && show(i)));

// ---------------------------------------------------------------- run
$('runBtn').onclick = async () => {
  const btn = $('runBtn');
  btn.disabled = true; btn.textContent = 'Retrieving, drafting, verifying...';
  $('err').innerHTML = '';

  const sector = sel.value;
  const rfp = $('rfp').value.trim();
  const r = retrieve(CORPUS, { sector, rfpText: rfp });
  state.retrieval = r;
  renderLedger(r);

  let draft, model;
  try {
    const res = await fetch('/api/draft', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rfp, sector, sources: r.used.map(({ id, title, text, client, date }) => ({ id, title, text, client, date })) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error + ' - ' + (data.groq || ''));
    draft = data; model = data.model;
  } catch (e) {
    // Demo rail: a cached real run so a dead API never kills a live demo.
    const cached = await fetch(`./demo/${sector}.json`).catch(() => null);
    if (cached && cached.ok) { draft = await cached.json(); model = 'cached run (offline)'; }
    else {
      $('err').innerHTML = `<div class="err"><b>Drafting failed.</b><br>${String(e.message)}</div>`;
      btn.disabled = false; btn.textContent = 'Generate evidence-grounded draft'; return;
    }
  }

  $('modelChip').textContent = 'model: ' + model;
  state.verified = verifyDraft(draft, CORPUS, rfp);
  state.resolved = new Set();
  state.section = 0; state.claim = null;
  tabs[1].disabled = tabs[2].disabled = false;
  renderWorkspace();
  btn.disabled = false; btn.textContent = 'Regenerate draft';
  show(1);
};

// ---------------------------------------------------------------- render
function renderLedger(r) {
  $('ledger').innerHTML = `
  <div class="ledger">
    <h4>Retrieval &amp; eligibility ledger</h4>
    <div class="funnel">
      <div class="fstep"><b>${r.matched.length}</b><span>matched</span></div>
      <div class="fstep"><b>${r.eligible.length}</b><span>eligible</span></div>
      <div class="fstep"><b>${r.used.length}</b><span>used</span></div>
    </div>
    <div class="excl">${r.excluded.map((e) => `<div><code>${e.id}</code> ${e.title} &mdash; ${e.reason}</div>`).join('') || '<div>No sources excluded.</div>'}</div>
  </div>`;
}

const shortStatus = { [STATUS.GROUNDED]: 'GROUNDED', [STATUS.PARTIAL]: 'PARTIAL', [STATUS.UNSUPPORTED]: 'UNSUPPORTED', [STATUS.JUDGMENT]: 'JUDGMENT', [STATUS.CONFLICTING]: 'CONFLICTING', [STATUS.BRIEF]: 'FROM BRIEF' };
const cls = (s) => 's-' + s.split(' ')[0];

function renderWorkspace() {
  const { sections } = state.verified;
  $('secNav').innerHTML = sections.map((s, i) => {
    const bad = s.claims.filter((c) => BLOCKING.includes(c.status)).length;
    return `<div class="secitem ${i === state.section ? 'cur' : ''}" data-sec="${i}">${s.heading}<span class="glyphs">${bad ? '&#9679;'.repeat(Math.min(bad, 3)) : '&#9675;'}</span></div>`;
  }).join('');
  $('secNav').querySelectorAll('[data-sec]').forEach((el) => (el.onclick = () => { state.section = +el.dataset.sec; renderWorkspace(); }));

  $('doc').innerHTML = `<h2>${$('client').value} &mdash; Proposal</h2>
    <div class="meta">${SECTORS[sel.value].label} &middot; ${$('deal').value} &middot; due ${$('due').value} &middot; draft, not sent</div>` +
    sections.map((s, si) => `<h3>${s.heading}</h3><p>` + s.claims.map((c, ci) => {
      const flag = BLOCKING.includes(c.status) && !state.resolved.has(si + ':' + ci);
      const key = si + ':' + ci;
      const src = (c.sourceIds || []).join(' ') || (c.status === STATUS.BRIEF || c.status === STATUS.JUDGMENT ? '&mdash;' : 'no source');
      return `<span class="claim ${flag ? 'flag ' + cls(c.status) : ''} ${state.claim === key ? 'cur' : ''}" data-k="${key}">${c.text}<span class="cite ${cls(c.status)}">${src} &middot; ${shortStatus[c.status]}</span></span> `;
    }).join('') + '</p>').join('');

  $('doc').querySelectorAll('[data-k]').forEach((el) => (el.onclick = () => { state.claim = el.dataset.k; renderWorkspace(); renderEvidence(); }));
  if (state.claim) renderEvidence();
}

function claimAt(key) { const [si, ci] = key.split(':').map(Number); return state.verified.sections[si].claims[ci]; }

function renderEvidence() {
  if (!state.claim) return;
  const c = claimAt(state.claim);
  $('ev').innerHTML =
    `<div class="cite ${cls(c.status)}" style="display:inline-block;margin-bottom:9px">${shortStatus[c.status]}</div>
     <p class="reason">${c.reason}</p>` +
    (c.evidence.length
      ? c.evidence.map((e) => {
          const s = CORPUS.find((x) => x.id === e.sourceId);
          return `<div class="evcard"><div class="t">${e.title}</div>
            <div class="m">${e.sourceId} &middot; ${s.client} &middot; ${s.date} &middot; authority ${s.authority}</div>
            <blockquote>${e.excerpt}</blockquote></div>`;
        }).join('')
      : '<p class="empty">No eligible source supports this claim. It must be removed, rewritten, or backed by a source before release.</p>');
}

function renderReview() {
  const items = [];
  state.verified.sections.forEach((s, si) => s.claims.forEach((c, ci) => {
    if (BLOCKING.includes(c.status)) items.push({ key: si + ':' + ci, section: s.heading, c });
  }));

  $('qcount').textContent = `${items.filter((i) => !state.resolved.has(i.key)).length} open / ${items.length} total`;
  $('queue').innerHTML = items.length ? items.map((i) => {
    const done = state.resolved.has(i.key);
    return `<div class="item ${done ? 'done' : ''}">
      <div class="cite ${cls(i.c.status)}" style="display:inline-block">${shortStatus[i.c.status]}</div>
      <span style="font-size:11px;color:var(--muted);margin-left:8px">${i.section}</span>
      <p>${i.c.text}</p>
      <div class="reason" style="margin:0 0 9px">${i.c.reason}</div>
      <div class="acts">${done
        ? '<button data-undo="' + i.key + '">Reopen</button>'
        : '<button data-fix="' + i.key + '">Remove claim</button><button data-fix="' + i.key + '">Accept with human sign-off</button>'}</div>
    </div>`;
  }).join('') : '<div class="item"><p class="empty">No exceptions. Every material claim is grounded or judgment.</p></div>';

  $('queue').querySelectorAll('[data-fix]').forEach((b) => (b.onclick = () => { state.resolved.add(b.dataset.fix); renderReview(); renderWorkspace(); }));
  $('queue').querySelectorAll('[data-undo]').forEach((b) => (b.onclick = () => { state.resolved.delete(b.dataset.undo); renderReview(); renderWorkspace(); }));

  const open = items.filter((i) => !state.resolved.has(i.key)).length;
  $('sign1').disabled = open > 0;
  if (open > 0) $('sign1').checked = false;
  $('why1').textContent = open > 0
    ? `Locked. ${open} unresolved exception${open > 1 ? 's' : ''} in the draft.`
    : 'All exceptions resolved by a human. Content sign-off is now available.';
  gate();
}

const gate = () => {
  const ok = $('sign1').checked && $('sign2').checked;
  $('approveBtn').disabled = !ok;
  $('blockmsg').textContent = ok ? '' : 'Release is blocked until both tracks are signed.';
};
$('sign1').onchange = $('sign2').onchange = gate;
$('approveBtn').onclick = () => { $('approveBtn').textContent = 'Released ✓'; $('blockmsg').textContent = ''; };
