"""Heavy PDF work. All functions are synchronous/blocking and are meant to be
called from a thread pool by the queue worker. They take a real file path because
the underlying libraries (pdf-cmap-fix, pymupdf4llm) open by path.
"""

from __future__ import annotations

from typing import Optional

import fitz  # PyMuPDF
import pymupdf4llm

from pdf_cmap_fix import patch_pdf

from . import docx_export, legacy_tibetan


class ProcessingError(Exception):
    """Raised when a PDF cannot be processed (corrupt, encrypted, etc.)."""


def looks_like_pdf(data: bytes) -> bool:
    return data[:5] == b"%PDF-"


def _open(pdf_path: str) -> "fitz.Document":
    try:
        doc = fitz.open(pdf_path)
    except Exception as exc:  # corrupt / not a pdf
        raise ProcessingError(f"Could not open PDF: {exc}") from exc
    if doc.needs_pass:
        doc.close()
        raise ProcessingError("This PDF is password-protected and cannot be processed.")
    return doc


def _select_pages(page_count: int, mode: str) -> list[int]:
    """Map a page mode to 0-based indices. 'even'/'odd' refer to 1-based page numbers."""
    if mode == "even":
        return [i for i in range(page_count) if (i + 1) % 2 == 0]
    if mode == "odd":
        return [i for i in range(page_count) if (i + 1) % 2 == 1]
    return list(range(page_count))


def analyze_pdf(pdf_path: str) -> dict:
    """Inspect a PDF without modifying it: page count, fonts, legacy detection."""
    doc = _open(pdf_path)
    try:
        fonts: dict[str, dict] = {}
        for page in doc:
            for f in page.get_fonts(full=True):
                base_font = f[3] or "(unnamed)"
                ftype = f[1] or ""
                if base_font not in fonts:
                    fonts[base_font] = {"name": base_font, "type": ftype}
        legacy = legacy_tibetan.detect_legacy_fonts(doc)
        return {
            "page_count": doc.page_count,
            "fonts": list(fonts.values()),
            "legacy_fonts": legacy,
            "has_legacy_tibetan": bool(legacy),
            "legacy_supported": legacy_tibetan.is_available(),
        }
    finally:
        doc.close()


def process_fix(pdf_path: str, tibetan_unicode: bool = False) -> dict:
    """Repair the /ToUnicode CMap so copy-paste works. Optionally also inject
    Unicode CMaps for legacy Tibetan fonts. Returns patched PDF bytes + stats.
    """
    try:
        result = patch_pdf(pdf_path, write_file=False)
    except Exception as exc:
        raise ProcessingError(f"CMap repair failed: {exc}") from exc

    pdf_bytes = result["pdf_bytes"]
    stats = dict(result.get("stats", {}))
    legacy_stats = None

    if tibetan_unicode and legacy_tibetan.is_available():
        # Re-open the already-patched bytes and add legacy ToUnicode CMaps.
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            legacy_stats = legacy_tibetan.inject_unicode_cmaps(doc)
            pdf_bytes = doc.tobytes(garbage=4, deflate=True)
        finally:
            doc.close()

    return {
        "kind": "pdf",
        "pdf_bytes": pdf_bytes,
        "stats": stats,
        "legacy_stats": legacy_stats,
        "size": len(pdf_bytes),
    }


def process_extract(
    pdf_path: str,
    pages_mode: str = "all",
    tibetan_unicode: bool = False,
) -> dict:
    """Extract text. Markdown via PyMuPDF4LLM by default; Unicode-converted plain
    text when legacy Tibetan conversion is requested and available.
    """
    doc = _open(pdf_path)
    try:
        page_count = doc.page_count
        indices = _select_pages(page_count, pages_mode)
        if not indices:
            return {"kind": "text", "text": "", "format": "markdown", "page_count": page_count, "pages_used": 0}

        use_legacy = tibetan_unicode and legacy_tibetan.is_available()
        if use_legacy and legacy_tibetan.detect_legacy_fonts(doc):
            text = legacy_tibetan.convert_pdf_to_unicode_text(doc, indices)
            fmt = "text"
        else:
            text = pymupdf4llm.to_markdown(pdf_path, pages=indices, show_progress=False)
            fmt = "markdown"
        # Build a .docx alongside the preview text (preserves formatting).
        try:
            docx_bytes = docx_export.to_docx_bytes(text, is_markdown=(fmt == "markdown"))
        except Exception:
            docx_bytes = b""  # never fail the extraction over the optional .docx
    except ProcessingError:
        raise
    except Exception as exc:
        raise ProcessingError(f"Extraction failed: {exc}") from exc
    finally:
        doc.close()

    return {
        "kind": "text",
        "text": text,
        "format": fmt,
        "page_count": page_count,
        "pages_used": len(indices),
        "pages_mode": pages_mode,
        "docx_bytes": docx_bytes,
        "docx_size": len(docx_bytes),
    }


def process(pdf_path: str, options: dict) -> dict:
    """Dispatch a job described by `options` to the right processor."""
    mode = options.get("mode", "fix")
    tibetan_unicode = bool(options.get("tibetan_unicode", False))
    if mode == "extract":
        pages_mode = options.get("pages", "all")
        if pages_mode not in ("all", "even", "odd"):
            pages_mode = "all"
        return process_extract(pdf_path, pages_mode, tibetan_unicode)
    return process_fix(pdf_path, tibetan_unicode)
