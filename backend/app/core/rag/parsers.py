from dataclasses import dataclass
from pathlib import Path

import docx
import pypdf


@dataclass
class ParsedPage:
    text: str
    page_number: int | None


class UnsupportedFileTypeError(Exception):
    pass


def parse_file(file_path: Path) -> list[ParsedPage]:
    """Extract text from a document, preserving page numbers where the format has them.

    PDF pages map 1:1 to ParsedPage.page_number. DOCX and plain text have no fixed
    pagination, so they collapse to a single page with page_number=None; citations
    for those formats fall back to chunk index instead of page number.
    """
    suffix = file_path.suffix.lower()
    if suffix == ".pdf":
        return _parse_pdf(file_path)
    if suffix == ".docx":
        return _parse_docx(file_path)
    if suffix in (".txt", ".md"):
        return _parse_text(file_path)
    raise UnsupportedFileTypeError(f"Unsupported file type: {suffix}")


def _parse_pdf(file_path: Path) -> list[ParsedPage]:
    reader = pypdf.PdfReader(str(file_path))
    pages: list[ParsedPage] = []
    for index, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if text.strip():
            pages.append(ParsedPage(text=text, page_number=index + 1))
    return pages


def _parse_docx(file_path: Path) -> list[ParsedPage]:
    document = docx.Document(str(file_path))
    text = "\n\n".join(p.text for p in document.paragraphs if p.text.strip())
    return [ParsedPage(text=text, page_number=None)] if text.strip() else []


def _parse_text(file_path: Path) -> list[ParsedPage]:
    text = file_path.read_text(encoding="utf-8", errors="ignore")
    return [ParsedPage(text=text, page_number=None)] if text.strip() else []
