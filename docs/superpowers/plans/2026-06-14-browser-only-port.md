# Browser-only Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Easy Tibetan Copy into a 100% client-side static app that fixes Tibetan PDFs in-browser via Pyodide running `pdf-cmap-fix`, with no server.

**Architecture:** A vanilla SPA (`web/`) whose UI state machine talks to a Web Worker that runs Pyodide. Server code is deleted. Outputs (fixed PDF, .txt, .docx) are produced in-memory and downloaded via Blob URLs. Deployed to GitHub Pages by a CI workflow that builds the `pdf-cmap-fix` wheel.

**Tech Stack:** Vanilla JS, Web Worker, Pyodide 0.29.4 (bundles PyMuPDF 1.26.3 + fonttools), `pdf-cmap-fix @ 007ef5b`, `python-docx`, GitHub Actions + Pages.

**Verification:** This is a browser app — "tests" are Playwright runs against a locally-served `web/`. The reference assertion is: legacy `TibetanChogyal` PDF → extracted text has Tibetan codepoints and **PUA=0**, fixed-PDF + .docx downloads work.

**Constants used throughout:**
- `PYODIDE_URL = https://cdn.jsdelivr.net/pyodide/v0.29.4/full/`
- `WHEEL_URL = ./wheels/pdf_cmap_fix-0.4.0-py3-none-any.whl`
- `PDFCMAPFIX_PIN = 007ef5b8744d4fed8f0c5ddd2eb445b0f8a02600`
- Size warning threshold: `WARN_MB = 20`

---

### Task 1: Remove server code, add .gitignore for wheel

**Files:**
- Delete: `app/main.py`, `app/processing.py`, `app/queue_manager.py`, `app/docx_export.py` (and any remaining `app/`), `run.sh`, `requirements.txt`
- Modify: `.gitignore` (create if absent)

- [ ] **Step 1: Delete server files**
```bash
git rm -r app run.sh requirements.txt
```
- [ ] **Step 2: Add .gitignore entries** so the built wheel and venv never get committed:
```
.venv/
web/wheels/
__pycache__/
.DS_Store
.playwright-mcp/
spike/browser-pyodide/*.pdf
```
- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "chore: remove FastAPI server (browser-only port)"
```

---

### Task 2: Wheel build script

**Files:**
- Create: `scripts/build-wheel.sh`

- [ ] **Step 1: Write the script**
```bash
#!/usr/bin/env bash
# Build the pure-python pdf-cmap-fix wheel into web/wheels/ (served same-origin).
set -euo pipefail
cd "$(dirname "$0")/.."
PIN=007ef5b8744d4fed8f0c5ddd2eb445b0f8a02600
OUT=web/wheels
mkdir -p "$OUT"
python3 -m pip wheel "git+https://github.com/OpenPecha/pdf-cmap-fix.git@${PIN}" --no-deps -w "$OUT"
echo "→ wheel in $OUT:"; ls -1 "$OUT"
```
- [ ] **Step 2: chmod + run, verify wheel appears**
```bash
chmod +x scripts/build-wheel.sh && ./scripts/build-wheel.sh
ls web/wheels/pdf_cmap_fix-0.4.0-py3-none-any.whl
```
Expected: the wheel file exists (~5.7 MB).
- [ ] **Step 3: Commit** (script only; wheel is gitignored)
```bash
git add scripts/build-wheel.sh && git commit -m "build: script to build pdf-cmap-fix wheel for the browser"
```

---

### Task 3: Pyodide Web Worker

**Files:**
- Create: `web/worker.js`

Responsibility: own Pyodide; boot lazily; handle `fix` and `extract` messages; report progress. Protocol mirrors the spec. The reference Python (proven in the spike) is `pdf_cmap_fix.patch_pdf(path, output_path, write_file=True)` and `pdf_cmap_fix.extract_pdf_text(path, write_files=False)`.

- [ ] **Step 1: Write `web/worker.js`**
```js
/* Easy Tibetan Copy — Pyodide engine (Web Worker) */
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.29.4/full/';
const WHEEL = new URL('./wheels/pdf_cmap_fix-0.4.0-py3-none-any.whl', self.location).href;
let py = null, booting = null;

function post(type, extra = {}) { self.postMessage({ type, ...extra }); }

async function boot() {
  if (py) return py;
  if (booting) return booting;
  booting = (async () => {
    post('progress', { phase: 'booting' });
    importScripts(PYODIDE + 'pyodide.js');
    py = await self.loadPyodide({ indexURL: PYODIDE });
    post('progress', { phase: 'loading-packages' });
    await py.loadPackage(['PyMuPDF', 'fonttools', 'micropip', 'lxml', 'typing-extensions']);
    post('progress', { phase: 'installing' });
    await py.runPythonAsync(`
import micropip
await micropip.install("${WHEEL}")
await micropip.install("python-docx", deps=False)
import pdf_cmap_fix
`);
    post('progress', { phase: 'ready' });
    return py;
  })();
  return booting;
}

async function analyze(bytes) {
  await boot();
  py.FS.writeFile('/in.pdf', bytes);
  const json = await py.runPythonAsync(`
import json, pymupdf
d = pymupdf.open("/in.pdf")
fonts = []
seen = set()
for p in range(d.page_count):
    for f in d.get_page_fonts(p):
        name = f[3]
        if name not in seen:
            seen.add(name); fonts.append(name)
json.dumps({"page_count": d.page_count, "fonts": fonts})
`);
  return JSON.parse(json);
}

async function fix() {
  post('progress', { phase: 'working' });
  const stats = await py.runPythonAsync(`
import json, pdf_cmap_fix
res = pdf_cmap_fix.patch_pdf("/in.pdf", output_path="/out.pdf", write_file=True)
json.dumps({k: res.get(k) for k in list(res)[:8]}, default=str)
`);
  const out = py.FS.readFile('/out.pdf');
  py.FS.unlink('/out.pdf');
  return { stats: JSON.parse(stats), pdfBytes: out };
}

async function extract(pages) {
  post('progress', { phase: 'working' });
  py.globals.set('_PAGES', pages || 'all');
  const meta = await py.runPythonAsync(`
import json, pymupdf, pdf_cmap_fix
# patch in memory first so legacy fonts come out as Unicode
pdf_cmap_fix.patch_pdf("/in.pdf", output_path="/patched.pdf", write_file=True)
d = pymupdf.open("/patched.pdf")
n = d.page_count
sel = list(range(n))
if _PAGES == 'odd':  sel = [i for i in sel if i % 2 == 0]   # 1-based odd = index 0,2,...
if _PAGES == 'even': sel = [i for i in sel if i % 2 == 1]
parts = [d[i].get_text() for i in sel]
txt = "\\n".join(parts)
globals()['_TXT'] = txt
json.dumps({"page_count": n, "pages_used": len(sel)})
`);
  const text = py.globals.get('_TXT');
  // build a .docx from the text
  const docxSize = await py.runPythonAsync(`
from docx import Document
doc = Document()
for para in _TXT.split("\\n"):
    if para.strip(): doc.add_paragraph(para)
doc.save("/out.docx")
import os; os.path.getsize("/out.docx")
`);
  const docxBytes = py.FS.readFile('/out.docx');
  py.FS.unlink('/out.docx'); py.FS.unlink('/patched.pdf');
  return { ...JSON.parse(meta), text: String(text), docxBytes };
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'boot') { await boot(); return; }
    if (m.type === 'analyze') {
      const a = await analyze(new Uint8Array(m.bytes));
      return post('analyzed', a);
    }
    if (m.type === 'fix') {
      const r = await fix();
      return post('fixed', r, [r.pdfBytes.buffer]);
    }
    if (m.type === 'extract') {
      const r = await extract(m.pages);
      return post('extracted', r, [r.docxBytes.buffer]);
    }
  } catch (err) {
    post('error', { message: (err && err.message) ? err.message : String(err) });
  }
};

// allow transferables in post()
function postT(type, extra, transfer) { self.postMessage({ type, ...extra }, transfer || []); }
```
Note: fix the `post('fixed', r, [..])` calls to use `self.postMessage({type,...r}, [transfer])`. Implement `post` to accept an optional transfer list:
```js
function post(type, extra = {}, transfer) { self.postMessage({ type, ...extra }, transfer || []); }
```
- [ ] **Step 2: (verification deferred to Task 7 — worker is exercised end-to-end there)**
- [ ] **Step 3: Commit**
```bash
git add web/worker.js && git commit -m "feat(worker): Pyodide engine running pdf-cmap-fix in a Web Worker"
```

---

### Task 4: Rework `app.js` to use the worker

**Files:**
- Modify: `web/app.js` (replace server `api`/poll/job logic)

Key changes:
- Remove `api()`, `poll()`, `reflect()`, `pollTimer`, `cfg.maxQueue`, the `/api/*` calls, server `download_url`/`token`/`job` concepts.
- Add a single worker instance + a `call(type, payload, transfer)` promise helper that resolves on the matching reply (`analyzed`/`fixed`/`extracted`) or rejects on `error`.
- `handleFile`: validate PDF; if `size > WARN_MB*1MB` show a warning + "continue anyway"; then `showProcessing('Warming up the engine…')`, boot worker (progress → sub-text), `analyze`, `renderConfig`.
- `submit`: for `fix` → `call('fix')` → `renderPdfResult({stats, pdfBytes})`; for `extract` → `call('extract',{pages})` → `renderTextResult({...})`.
- Results download from in-memory bytes via Blob URLs (no server URLs). `.docx` button uses `extracted.docxBytes`.
- Keep extracted-text result but drop all "markdown" wording → it's plain text.

- [ ] **Step 1: Replace the IIFE body.** Full new `web/app.js` (keeps `showView`, `toast`, `esc`, dropzone wiring verbatim; swaps the engine):
  - Worker helper:
```js
let worker = null, seq = 0, pending = {};
function engine() {
  if (worker) return worker;
  worker = new Worker('worker.js');
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') { onPhase(m.phase); return; }
    if (m.type === 'error') { const p = pending.cur; if (p) { delete pending.cur; p.reject(new Error(m.message)); } return; }
    const p = pending.cur;
    if (p) { delete pending.cur; p.resolve(m); }
  };
  return worker;
}
function call(type, payload = {}, transfer) {
  return new Promise((resolve, reject) => {
    pending.cur = { resolve, reject };
    engine().postMessage({ type, ...payload }, transfer || []);
  });
}
function onPhase(phase) {
  const map = { booting: 'Starting the engine…', 'loading-packages': 'Loading the PDF toolkit…', installing: 'Loading the Tibetan fixer…', ready: 'Engine ready.', working: 'Working on your document…' };
  if ($('proc-sub')) $('proc-sub').textContent = map[phase] || '';
}
```
  - `handleFile`:
```js
const WARN_MB = 20;
async function handleFile(file) {
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))
    return toast('Please choose a PDF file.');
  state = { filename: file.name, mode: 'fix', pages: 'all' };
  const bigMb = file.size / 1048576;
  if (bigMb > WARN_MB && !file._confirmed) return renderSizeWarning(file, bigMb);
  $('proc-title').textContent = 'Reading your document…';
  $('proc-sub').textContent = 'Warming up the engine…';
  $('proc-queue').hidden = true;
  showView('processing');
  try {
    const buf = await file.arrayBuffer();
    state.bytes = new Uint8Array(buf);            // keep for fix/extract
    const a = await call('analyze', { bytes: state.bytes.buffer.slice(0) });
    state.analysis = a;
    renderConfig();
  } catch (err) { showError(err.message); }
}
function renderSizeWarning(file, mb) {
  $('view-error') // reuse a simple inline warning panel in processing view
  $('proc-title').textContent = 'Large file';
  $('proc-sub').innerHTML = `This PDF is ${mb.toFixed(0)} MB. Large files can use a lot of memory and may crash the browser tab — a desktop computer is recommended. `;
  $('proc-queue').hidden = true;
  showView('processing');
  const sub = $('proc-sub');
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary'; btn.textContent = 'Continue anyway';
  btn.style.marginTop = '14px';
  btn.onclick = () => { file._confirmed = true; handleFile(file); };
  sub.appendChild(document.createElement('br')); sub.appendChild(btn);
}
```
  - `submit` / results use `state.bytes` and returned bytes (Blob downloads). `renderPdfResult(stats, pdfBytes)` builds a Blob download; `renderTextResult(meta)` shows text, Copy, .txt save, .docx save from `meta.docxBytes`.
- [ ] **Step 2: Verify nothing references `/api/` or `download_url` anymore**
```bash
grep -nE "/api/|download_url|pollTimer|maxQueue|token" web/app.js || echo "clean"
```
Expected: `clean`.
- [ ] **Step 3: Commit**
```bash
git add web/app.js && git commit -m "feat(ui): drive fixing/extraction through the Pyodide worker, no server"
```

---

### Task 5: `index.html` updates

**Files:**
- Modify: `web/index.html`

- [ ] **Step 1:** Update copy and wiring:
  - Byline: replace "Your file never leaves this server." → "Your file never leaves your browser."
  - Remove the `Wraps OpenPecha · pdf-cmap-fix` byline link is fine to keep (attribution), but drop server-only phrasing.
  - Footer: replace server/queue/wipe text → "Everything runs in your browser. Your file is never uploaded."
  - Ensure `<script src="/app.js">` works with relative paths on Pages → change `/app.js`, `/styles.css` to relative `app.js`, `styles.css` (Pages may serve under a subpath).
  - `limit-pill` no longer fed by server config — set static text e.g. `PDF` (drop the MB cap pill, or keep a soft "best under 20 MB").
- [ ] **Step 2: Commit**
```bash
git add web/index.html && git commit -m "feat(ui): browser-only copy + relative asset paths"
```

---

### Task 6: Service worker (cache Pyodide + wheel)

**Files:**
- Create: `web/sw.js`
- Modify: `web/app.js` (register SW)

- [ ] **Step 1: Write `web/sw.js`** — runtime cache-first for jsdelivr Pyodide assets and the local wheel:
```js
const CACHE = 'etc-pyodide-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  if (url.includes('cdn.jsdelivr.net/pyodide/') || url.includes('/wheels/')) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
      return res;
    }));
  }
});
```
- [ ] **Step 2: Register in `app.js` init:**
```js
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
```
- [ ] **Step 3: Commit**
```bash
git add web/sw.js web/app.js && git commit -m "feat(pwa): service worker caches Pyodide assets + wheel"
```

---

### Task 7: Playwright end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Serve and drive the legacy case.** Serve `web/` on :8777, drive Chromium: upload the reference `TibetanChogyal` PDF (copied into the project), run Fix, then Extract.
- [ ] **Step 2: Assert** in the result/console: fix produces a PDF blob; extracted text contains Tibetan codepoints (U+0F00–0FFF) and **PUA=0**; .docx download produces bytes. (Add a tiny debug line to the result, or read text via Playwright `browser_evaluate`.)
- [ ] **Step 3: Unicode case** — upload `M8_Tibetan_1.pdf` (Microsoft Himalaya), confirm Fix succeeds with no error.
- [ ] **Step 4: Size guard** — synthesize/upload a >20 MB PDF, confirm the warning panel + "Continue anyway" appears and is required.
- [ ] **Step 5: Commit** any fixes made during verification.

---

### Task 8: Deploy workflow + README

**Files:**
- Create: `.github/workflows/deploy-pages.yml`
- Modify: `README.md`

- [ ] **Step 1: Workflow**
```yaml
name: Deploy to GitHub Pages
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - name: Build wheel
        run: ./scripts/build-wheel.sh
      - uses: actions/upload-pages-artifact@v3
        with: { path: web }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: '${{ steps.deployment.outputs.page_url }}' }
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```
- [ ] **Step 2: Rewrite `README.md`** — browser-only app: what it does (fix + copy/paste + .txt/.docx), how it works (Pyodide + pdf-cmap-fix, all client-side, no upload), local dev (`./scripts/build-wheel.sh` then serve `web/`), deployment (Pages via Actions; enable Pages with "GitHub Actions" source), large-file note, credits to OpenPecha/pdf-cmap-fix, license.
- [ ] **Step 3: Commit**
```bash
git add .github/workflows/deploy-pages.yml README.md && git commit -m "ci(pages): auto-deploy + rewrite README for browser-only app"
```

---

## Self-Review notes
- Spec coverage: server removal (T1), wheel build (T2), worker engine (T3), UI rework + size warning (T4), privacy copy + relative paths (T5), service worker (T6), verification incl. PUA=0 (T7), deploy + README (T8). All spec sections covered.
- Markdown is dropped everywhere (T4 text result is plain text; T5/README no markdown).
- `extract` odd/even mapping documented (1-based odd = 0-based even indices).
- The `post()` transfer helper must accept a transfer list (noted in T3).
