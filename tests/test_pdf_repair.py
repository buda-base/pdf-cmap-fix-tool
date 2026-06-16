"""Regression test for the bundled pdf-cmap-fix wheel.

Guards the "N fonts found, 0 fixed" failure: a legacy Tibetan PDF whose Type1
"Ededris" subsets ship *no* /ToUnicode at all. The tool must synthesize one
(pdf-cmap-fix PR #14). A wheel built from a pre-PR#14 pin regresses this to
``patched == 0`` — which is exactly what reached production once and is what
this test exists to catch.

Fixture: page 1 of Thrangu_Sungtsom_Thorbu.pdf (BDRC IE3JT13381).

Run (after `pip install web/wheels/*.whl pymupdf fonttools`):
    python -m pytest tests/test_pdf_repair.py -q
"""

import os
import re

import pytest

HERE = os.path.dirname(__file__)
FIXTURE = os.path.join(HERE, "fixtures", "thrangu-p1.pdf")

# Mirrors the normalization in web/worker.js `_xml_clean`: legacy fonts map
# their space glyph to a Control-Pictures symbol (U+2423 open box "␣") and the
# /ToUnicode carries it straight through, so extracted text shows "༡␣ཁ". The
# worker turns the box back into a real space and drops the other control-pic
# stand-ins. Kept in sync by the tests below.
_XML_BAD = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]")
_CTRL_PICS = re.compile("[␀-␢␤]")


def _xml_clean(s):
    s = _XML_BAD.sub("", s)
    s = s.replace("␣", " ")
    return _CTRL_PICS.sub("", s)

# Skip cleanly when the wheel isn't installed yet (e.g. fresh checkout).
pdf_cmap_fix = pytest.importorskip(
    "pdf_cmap_fix", reason="install the bundled wheel first: pip install web/wheels/*.whl"
)
import fitz  # noqa: E402  PyMuPDF — a wheel runtime dependency


def test_repairs_legacy_tibetan_without_tounicode(tmp_path):
    out = str(tmp_path / "out.pdf")
    stats = pdf_cmap_fix.patch_pdf(FIXTURE, output_path=out, write_file=True)["stats"]

    assert stats["patched"] > 0, (
        f"no fonts repaired — stale/wrong wheel pin? stats={stats}"
    )

    text = fitz.open(out)[0].get_text()
    tibetan = sum(1 for c in text if 0x0F00 <= ord(c) <= 0x0FFF)
    assert tibetan > 100, (
        f"expected real Tibetan Unicode after repair, got {tibetan} codepoints"
    )


def test_normalizes_control_picture_space():
    # The legacy space glyph extracts as the open box U+2423; the worker turns
    # it back into a real space and strips the other control-picture symbols.
    assert _xml_clean("༁␣ཁ␀") == "༁ ཁ"


def test_fixed_pdf_extraction_box_normalizes_to_space(tmp_path):
    out = str(tmp_path / "out.pdf")
    pdf_cmap_fix.patch_pdf(FIXTURE, output_path=out, write_file=True)
    raw = fitz.open(out)[0].get_text()
    assert "␣" in raw, "fixture no longer exercises the U+2423 path"
    cleaned = _xml_clean(raw)
    assert "␣" not in cleaned
    assert not any(0x2400 <= ord(c) <= 0x2424 for c in cleaned)
