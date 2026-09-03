// Drafting only. This endpoint never decides what is true - engine.js does that
// in the browser, deterministically, on whatever the model returns.

import { SYSTEM, userPrompt } from '../prompt.js';


// Env values pasted through a dashboard pick up stray whitespace, quotes, or even
// the whole "NAME=value" line. Normalise rather than fail with an opaque 401.
const envKey = (name) => {
  let v = (process.env[name] || '').trim();
  if (v.startsWith(`${name}=`)) v = v.slice(name.length + 1).trim();
  return v.replace(/^["']|["']$/g, '');
};

// Safe to expose: shape only, never the value.
const keyShape = (name) => {
  const raw = process.env[name];
  if (!raw) return `${name} is not set`;
  const v = envKey(name);
  return `${name}: ${v.length} chars, starts "${v.slice(0, 4)}", ${raw.trim() === raw ? 'no' : 'HAD'} surrounding whitespace`;
};

async function groq(prompt) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${envKey('GROQ_API_KEY')}` },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) throw new Error(`groq ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return JSON.parse((await r.json()).choices[0].message.content);
}

async function gemini(prompt) {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': envKey('GEMINI_API_KEY') },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
    }),
  });
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return JSON.parse((await r.json()).candidates[0].content.parts[0].text);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { rfp, sector, sources } = req.body || {};
  if (!rfp || !sources?.length) return res.status(400).json({ error: 'rfp and sources are required' });

  const prompt = userPrompt(rfp, sector, sources);
  try {
    const draft = await groq(prompt);
    return res.status(200).json({ ...draft, model: 'GPT-OSS 120B (Groq)' });
  } catch (e1) {
    try {
      const draft = await gemini(prompt);
      return res.status(200).json({ ...draft, model: 'Gemini 3.6 Flash (fallback)', fallbackFrom: String(e1.message) });
    } catch (e2) {
      return res.status(502).json({ error: 'Both models failed', groq: String(e1.message), gemini: String(e2.message),
        keys: [keyShape('GROQ_API_KEY'), keyShape('GEMINI_API_KEY')] });
    }
  }
}
