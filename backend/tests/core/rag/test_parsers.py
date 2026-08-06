from pathlib import Path

import pytest

from app.core.rag.parsers import parse_file, UnsupportedFileTypeError

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def test_parse_txt_returns_single_page_with_no_page_number():
    pages = parse_file(FIXTURES / "sample.txt")
    assert len(pages) == 1
    assert pages[0].page_number is None
    assert "retrieval-augmented" in pages[0].text


def test_parse_md_returns_single_page():
    pages = parse_file(FIXTURES / "sample.md")
    assert len(pages) == 1
    assert "Markdown ingestion" in pages[0].text


def test_parse_empty_txt_returns_no_pages(tmp_path):
    empty_file = tmp_path / "empty.txt"
    empty_file.write_text("   \n  ")
    assert parse_file(empty_file) == []


def test_unsupported_extension_raises(tmp_path):
    bad_file = tmp_path / "sample.xyz"
    bad_file.write_text("data")
    with pytest.raises(UnsupportedFileTypeError):
        parse_file(bad_file)


def test_parse_pdf_maps_pages_to_page_numbers_and_skips_blank_pages():
    pages = parse_file(FIXTURES / "sample.pdf")

    # sample.pdf has 3 pages; page 2 is intentionally blank. The surviving
    # ParsedPage list must keep the ORIGINAL 1-indexed page numbers (1 and 3),
    # not be renumbered to 1 and 2, per the binding constraint that PDF pages
    # map 1:1 to ParsedPage.page_number.
    assert [p.page_number for p in pages] == [1, 3]
    assert "DocMind AI Page One" in pages[0].text
    assert "DocMind AI Page Three" in pages[1].text


def test_parse_docx_returns_single_page_with_paragraphs_joined():
    pages = parse_file(FIXTURES / "sample.docx")

    assert len(pages) == 1
    assert pages[0].page_number is None
    assert "DocMind AI supports DOCX ingestion" in pages[0].text
    assert "joined together into a single unpaginated page" in pages[0].text
    # The blank/whitespace-only paragraph in the fixture must not produce an
    # empty entry or a run of extra blank lines between the two real
    # paragraphs.
    assert "\n\n\n" not in pages[0].text
