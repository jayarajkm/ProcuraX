"""Text extraction. Returns [(page_number|None, text)]."""
import csv
import io

ALLOWED = {"pdf", "docx", "txt", "csv"}


class ExtractionError(Exception):
    pass


def validate_upload(filename: str, data: bytes, max_bytes: int) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED:
        raise ExtractionError(f"File type '.{ext}' not allowed. Allowed: {', '.join(sorted(ALLOWED))}")
    if not data:
        raise ExtractionError("File is empty")
    if len(data) > max_bytes:
        raise ExtractionError(f"File exceeds the {max_bytes // (1024 * 1024)} MB limit")
    if ext == "pdf" and not data.startswith(b"%PDF"):
        raise ExtractionError("File content is not a valid PDF")
    if ext == "docx" and not data.startswith(b"PK"):
        raise ExtractionError("File content is not a valid DOCX")
    if ext in ("txt", "csv"):
        if b"\x00" in data[:4096]:
            raise ExtractionError("File appears to be binary, not text")
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            raise ExtractionError("Text files must be UTF-8 encoded")
    return ext


def extract(path: str, ext: str) -> list[tuple[int | None, str]]:
    try:
        if ext == "txt":
            return [(None, open(path, encoding="utf-8").read())]
        if ext == "csv":
            rows = list(csv.reader(open(path, encoding="utf-8", newline="")))
            if not rows:
                return []
            head = rows[0]
            return [(None, "\n".join("; ".join(f"{h}: {v}" for h, v in zip(head, r)) for r in rows[1:]))]
        if ext == "pdf":
            from pypdf import PdfReader
            return [(i + 1, p.extract_text() or "") for i, p in enumerate(PdfReader(path).pages)]
        if ext == "docx":
            from docx import Document as D
            d = D(path)
            parts = [p.text for p in d.paragraphs if p.text.strip()]
            for t in d.tables:
                parts += [" | ".join(c.text for c in r.cells) for r in t.rows]
            return [(None, "\n".join(parts))]
    except Exception as e:
        raise ExtractionError(f"Could not read {ext.upper()} file: {e}") from e
    raise ExtractionError(f"Unsupported type {ext}")


def chunk_text(pages: list[tuple[int | None, str]], size: int = 800, overlap: int = 120) -> list[dict]:
    """Paragraph/sentence-aware chunking, never crossing page boundaries (so page numbers stay exact)."""
    import re
    out = []
    for page, text in pages:
        text = re.sub(r"[ \t]+", " ", text).strip()
        if not text:
            continue
        units = [u.strip() for u in re.split(r"(?<=[.!?])\s+|\n{2,}|\n", text) if u.strip()]
        cur = ""
        for u in units:
            if cur and len(cur) + len(u) + 1 > size:
                out.append({"page": page, "content": cur})
                cur = cur[-overlap:].split(" ", 1)[-1] + " " + u if overlap else u
            else:
                cur = f"{cur} {u}".strip()
        if cur:
            out.append({"page": page, "content": cur})
    return out
