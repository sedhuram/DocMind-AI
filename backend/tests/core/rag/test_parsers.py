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
