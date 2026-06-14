# Easy Tibetan Copy — Browser-only (server-less) port

**Date:** 2026-06-14
**Status:** Approved design
**Branch:** `feature/browser-only-port`

## Goal

Turn Easy Tibetan Copy from a FastAPI web app (server processes the PDF) into a
**100% client-side** static app: the PDF is fixed entirely in the browser via
Pyodide running the real upstream `pdf-cmap-fix`. No server, no upload — the file
never leaves the user's device. Hostable on GitHub Pages.

This is validated: a spike (`spike/browser-pyodide/`) ran the real `pdf-cmap-fix`
in-browser and fixed the 168-page legacy `TibetanChogyal` reference PDF with
quality identical to the server (59,240 Tibetan codepoints, PUA=0), ~4s cold boot,
~4s patch.

## Decisions (locked)

- **Engine:** Pyodide **0.29.4** (bundles PyMuPDF 1.26.3 + fonttools 4.56.0) +
  `micropip`-installed `pdf-cmap-fix @ 007ef5b` (pure-python wheel) + `python-docx`
  (deps via bundled `lxml` / `typing-extensions`).
- **Markdown extraction: dropped.** `pymupdf4llm` hard-requires pymupdf 1.27.2.3
  (Pyodide has 1.26.3) and refuses to import. Text extraction uses
  `pdf_cmap_fix.extract_pdf_text` (clean Unicode, validated). Outputs: fixed PDF,
  `.txt`, `.docx`.
- **Server code: removed from the repo** (git history retains it).
- **Large files: warn, don't block.** Files over **20 MB** show a clear warning
  ("large file, the tab may crash, prefer a computer") with a "continue anyway"
  action. Measured: ~10 MB is comfortable everywhere; a 52 MB PDF peaked ~1.16 GB
  WASM and crashed the tab.
- **Deployment:** GitHub Actions workflow builds the wheel and deploys `web/` to
  GitHub Pages on push to `main`. Repo is `buda-base/pdf-cmap-fix-tool`.
- **Approach A:** minimal rewrite of the existing SPA — keep the Easy Tibetan Copy
  design and state machine, swap the server engine for a Pyodide **Web Worker**.

## Architecture

### Components

- **`web/app.js`** — main thread / UI. Existing state machine (upload → config →
  processing → result → error), with all server coupling removed (no queue, no
  polling, no tokens, no two-phase analyze/job). Talks to the worker via
  `postMessage`.
- **`web/worker.js`** — Web Worker holding Pyodide. Lazily boots on first use:
  `loadPyodide(0.29.4)` → `loadPackage([PyMuPDF, fonttools, micropip, lxml,
  typing-extensions])` → `micropip.install([wheelURL, "python-docx"], deps=False
  where needed)` → `import pdf_cmap_fix`. Then handles `analyze` / `fix` / `extract`
  messages. A Web Worker is required because patch_pdf can take many seconds and must
  not freeze the UI thread.
- **`web/sw.js`** — service worker caching the Pyodide CDN assets and the wheel so
  repeat visits are fast / offline-capable after the first load.

### Worker message protocol (postMessage)

Main → worker:
- `{type:'boot'}` — start loading the engine.
- `{type:'analyze', bytes}` — inspect fonts; returns font list.
- `{type:'fix', bytes}` — patch the PDF; returns `{stats, pdfBytes}`.
- `{type:'extract', bytes, pages}` — patch + extract text; returns `{text, docxBytes}`.

Worker → main:
- `{type:'progress', phase}` — `booting` | `loading-packages` | `installing` | `ready` | `working`.
- `{type:'result', ...}` — payload for the requested operation.
- `{type:'error', message}`.

Byte payloads are transferred (Transferable `ArrayBuffer`) to avoid copies.

### User flow

1. **Upload** — drop / pick a PDF. If size > 20 MB: warning banner + "continue anyway".
2. **Lazy boot** — on the first file, the worker boots Pyodide (a "warming up the
   engine…" state, ~3–5 s first time, instant after via SW cache). Pyodide is NOT
   loaded on mere page load.
3. **Config** — local font analysis (chips) + page option (all / odd / even, for
   two-up pecha-style books).
4. **Processing** — worker patches / extracts; UI stays responsive.
5. **Result** — downloads: fixed PDF, `.txt`, `.docx`.

### Privacy

Everything runs in the tab; the file never touches the network. UI copy updated:
"never leaves this server" → "never leaves your browser".

## Repo changes

### Removed (server)

`app/` (`main.py`, `queue_manager.py`, `processing.py`, `docx_export.py`), `run.sh`,
the server `requirements.txt`; README sections about the server / queue / run.

### Target structure

```
web/
  index.html        UI (lightened, privacy wording updated)
  styles.css
  app.js            UI state machine, server-free
  worker.js         Pyodide engine (Web Worker)
  sw.js             cache Pyodide assets + wheel
  wheels/           gitignored, filled by script / CI
scripts/
  build-wheel.sh    pip wheel "git+...@007ef5b..." -> web/wheels/
.github/workflows/
  deploy-pages.yml  build wheel + deploy web/ to Pages
docs/superpowers/specs/2026-06-14-browser-only-port-design.md
README.md           rewritten (browser app, no server)
```

### Wheel (not committed)

`scripts/build-wheel.sh` produces `pdf_cmap_fix-0.4.0-py3-none-any.whl` into
`web/wheels/` (gitignored) from the pinned commit `007ef5b`. Run once locally; CI
runs it before deploy. Keeps the 5.7 MB blob out of git and in sync with the pin.

### Pinned versions

Pyodide **0.29.4**, `pdf-cmap-fix @ 007ef5b` (bundles pymupdf 1.26.3). Referenced as
constants in `worker.js` and `build-wheel.sh`.

## Deployment

`.github/workflows/deploy-pages.yml`: on push to `main` → checkout → setup Python →
`scripts/build-wheel.sh` → upload `web/` as Pages artifact → deploy. Pyodide is
loaded from the jsdelivr CDN (repo stays light); the service worker caches it.

**User prerequisite (once):** enable GitHub Pages with the "GitHub Actions" source on
`buda-base/pdf-cmap-fix-tool`.

## Verification (definition of done)

Driven with Playwright against a locally-served `web/`:

1. **Legacy case** (Swift Path reference PDF) → fix OK; extracted text has Tibetan
   codepoints and **PUA=0**; PDF + `.docx` downloads work.
2. **Unicode case** (Microsoft Himalaya / M8) → fix OK, no regression.
3. **Size guard** → a >20 MB file triggers the warning without blocking.

CI does build+deploy only (no Playwright in CI — YAGNI).

## Out of scope

Markdown export, OCR for scanned PDFs, any server fallback, guaranteed mobile support
on large files, i18n.
