// Local dev server. Serves the static files and runs api/draft.js exactly as
// Vercel would. Node stdlib only - no vercel CLI, no login, no dependencies.
//   npm run dev  ->  http://localhost:3000
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import handler from './api/draft.js';

// Load .env.local into process.env (skips anything already set).
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
for (const k of ['GROQ_API_KEY', 'GEMINI_API_KEY']) {
  if (!process.env[k]) console.warn(`! ${k} is not set - drafting will fall back to the cached demo runs.`);
}

const TYPES = { html: 'text/html', js: 'text/javascript', json: 'application/json', png: 'image/png' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/draft') {
    const body = await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
    return handler(
      { method: req.method, body: body ? JSON.parse(body) : {} },
      { status(c) { this._c = c; return this; },
        json(o) { res.writeHead(this._c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); } },
    );
  }

  const path = '.' + (url.pathname === '/' ? '/index.html' : url.pathname);
  // Never serve dotfiles - .env.local lives in this directory.
  if (path.includes('..') || path.includes('/.') || !existsSync(path)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.split('.').pop()] || 'text/plain' });
  res.end(await readFile(path));
}).listen(3000, () => console.log('Vertex Proposal Intelligence -> http://localhost:3000'));
