/* Easy Tibetan Copy — Pyodide engine (Web Worker)
   Runs the real upstream pdf-cmap-fix entirely in the browser. The PDF bytes
   are passed in from the UI thread; nothing ever touches the network here
   except loading the Pyodide runtime + the wheel (cached by the service worker). */

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.29.4/full/';
const WHEEL = new URL('./wheels/pdf_cmap_fix-0.4.0-py3-none-any.whl', self.location).href;

let py = null;
let booting = null;

function post(type, extra = {}, transfer) {
  self.postMessage({ type, ...extra }, transfer || []);
}

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
fonts, seen = [], set()
for p in range(d.page_count):
    for f in d.get_page_fonts(p):
        name = f[3]
        if name and name not in seen:
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
# Patch first so legacy fonts come out as correct Unicode, then extract.
pdf_cmap_fix.patch_pdf("/in.pdf", output_path="/patched.pdf", write_file=True)
d = pymupdf.open("/patched.pdf")
n = d.page_count
sel = list(range(n))
if _PAGES == 'odd':   sel = [i for i in sel if i % 2 == 0]   # 1-based odd  -> indices 0,2,4...
elif _PAGES == 'even': sel = [i for i in sel if i % 2 == 1]  # 1-based even -> indices 1,3,5...
txt = "\\n".join(d[i].get_text() for i in sel)
globals()['_TXT'] = txt
json.dumps({"page_count": n, "pages_used": len(sel)})
`);
  const text = String(py.globals.get('_TXT'));
  const docxSize = await py.runPythonAsync(`
from docx import Document
doc = Document()
for para in _TXT.split("\\n"):
    if para.strip(): doc.add_paragraph(para)
doc.save("/out.docx")
import os; os.path.getsize("/out.docx")
`);
  const docxBytes = py.FS.readFile('/out.docx');
  py.FS.unlink('/out.docx');
  py.FS.unlink('/patched.pdf');
  return { ...JSON.parse(meta), text, docxBytes: docxBytes };
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'boot') { await boot(); return; }
    if (m.type === 'analyze') { return post('analyzed', await analyze(new Uint8Array(m.bytes))); }
    if (m.type === 'fix')     { const r = await fix();          return post('fixed', r, [r.pdfBytes.buffer]); }
    if (m.type === 'extract') { const r = await extract(m.pages); return post('extracted', r, [r.docxBytes.buffer]); }
  } catch (err) {
    post('error', { message: (err && err.message) ? err.message : String(err) });
  }
};
