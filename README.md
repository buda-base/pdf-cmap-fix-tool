# Pecha · Tibetan PDF Fix

A lightweight, modern web app around OpenPecha's
[`pdf-cmap-fix`](https://github.com/OpenPecha/pdf-cmap-fix) CLI.

Many Tibetan PDFs render perfectly on screen but copy/paste and extract as gibberish,
because the embedded font's `/ToUnicode` character map is broken or missing. Pecha
repairs that map so the text comes out correct — and can also extract clean text for you.

## What it does

- **Fix the PDF** — repairs the `/ToUnicode` CMap (via `pdf-cmap-fix`) so copy-paste,
  search and extraction return correct Unicode. Download the fixed PDF.
- **Extract text** — pulls clean, structured **Markdown** out of the PDF
  (via [PyMuPDF4LLM](https://pymupdf.readthedocs.io/en/latest/pymupdf4llm/)), with an
  option to take **only odd or only even pages** (handy for pecha-style books). Download
  it as `.md`/`.txt` or as a formatting-preserving **Word `.docx`** (rendered with
  [pandoc](https://pandoc.org/) when installed, otherwise `python-docx`).
- **Legacy Tibetan → Unicode** *(experimental)* — detects pre-Unicode Tibetan fonts and,
  when found, offers to convert them to Unicode both in the extracted text and as an
  in-place `/ToUnicode` injection in the downloaded PDF. Mappings come from BDRC's
  [`py-tiblegenc`](https://github.com/buda-base/py-tiblegenc).

## Design constraints (built in)

- **5 MB** upload limit.
- **One PDF processed at a time**, with a **50-slot waiting queue**; when full, callers
  are asked to retry shortly.
- **Nothing kept on disk.** Uploads touch a temp file only during processing (the
  libraries open by path), which is deleted immediately afterwards. Results live in
  memory and the fixed PDF is **wiped the moment you download it**; anything not
  downloaded is swept after 15 minutes.

## Run it

```bash
./run.sh                 # creates .venv, installs deps, starts on http://127.0.0.1:8000
# or pick a port:
PORT=9000 ./run.sh
```

Manual equivalent:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Then open the printed URL.

## Architecture

```
app/
  main.py            FastAPI: API + serves the static SPA, 5 MB cap, two-phase flow
  queue_manager.py   single-worker asyncio queue (50 slots), in-memory jobs, TTL sweep
  processing.py      the heavy work: analyze / fix / extract  (runs in a thread pool)
  legacy_tibetan.py  legacy-font detection, text conversion, /ToUnicode injection
web/
  index.html  styles.css  app.js   no build step — plain, fast, hand-crafted
```

**Request flow:** `POST /api/analyze` (inspect fonts, stage bytes, return a token) →
`POST /api/jobs` (`{token, mode, pages, tibetan_unicode}`) → poll `GET /api/jobs/{id}` →
`GET /api/jobs/{id}/download` (streams the PDF, then evicts it from memory).

See [`DECISIONS.md`](DECISIONS.md) for the reasoning behind each choice.

## Status / caveats

- The **core fix and extraction paths are tested** end-to-end (API + browser).
- **Legacy Tibetan conversion** has been validated on a real `TibetanChogyal` PDF: the
  injected `/ToUnicode` makes copy-paste return correct Unicode (verified clean — no quote
  or PUA artifacts across all pages). Coverage still depends on the font being present in
  BDRC's `tiblegenc` mapping; please test your own samples and report fonts that don't convert.
- The queue is in-process: state is per-instance and not shared across workers, so run a
  single Uvicorn worker (the default here).

## Licenses

This wrapper is under the repository's `LICENSE`. It depends on `pdf-cmap-fix` (MIT) and
`py-tiblegenc` (Apache-2.0).
