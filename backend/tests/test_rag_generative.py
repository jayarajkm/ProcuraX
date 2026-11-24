import io
import os
import pytest
from sqlalchemy import select, func
from app.chatbot.generative import provider as prov
from app.chatbot.generative.provider import LLMProvider, LLMResponse
from app.chatbot.rag import engine as rag
from app.ingestion import extract as X
from app.models import Document, DocumentChunk, DocumentProcessingJob
from app.services import documents as docs

B = "/api/v1"


class FakeProvider(LLMProvider):
    """Test double. Lives in tests only; production never substitutes a fake."""
    name = "fake"

    def __init__(self, reply="Approval above the threshold needs a Procurement Manager [1]."):
        self.calls, self.reply = [], reply

    def complete(self, system, messages, max_tokens=1024, temperature=0.2):
        self.calls.append((system, messages))
        return LLMResponse(self.reply, "fake-model", 10, 5)


@pytest.fixture()
def fake():
    p = FakeProvider(); prov.set_provider_override(p)
    yield p
    prov.set_provider_override(None)


# ---- extraction / chunking
def test_validate_upload_rules():
    mx = 1024
    assert X.validate_upload("a.txt", b"hello", mx) == "txt"
    for name, data in [("a.exe", b"x"), ("a.pdf", b"not a pdf"), ("a.docx", b"nope"), ("a.txt", b""), ("a.txt", b"x" * 2000), ("a.txt", b"\xff\xfe\x00bin")]:
        with pytest.raises(X.ExtractionError):
            X.validate_upload(name, data, mx)


def test_chunking_respects_pages_and_size():
    pages = [(1, "Alpha sentence one. " * 100), (2, "Beta page two content. " * 5)]
    ch = X.chunk_text(pages, size=300, overlap=40)
    assert all(len(c["content"]) <= 380 for c in ch)
    assert {c["page"] for c in ch} == {1, 2} and all("Beta" not in c["content"] for c in ch if c["page"] == 1)


# ---- retrieval against the real, indexed seed documents (real embeddings)
def test_documents_indexed(db):
    assert db.scalar(select(func.count()).select_from(Document).where(Document.status == "indexed")) == 10
    assert db.scalar(select(func.count()).select_from(DocumentChunk)) >= 10


def test_semantic_retrieval_finds_right_document(tx_db):
    hits = docs.search_chunks(tx_db, "Who has to approve a purchase over five thousand dollars?", top_k=3, min_similarity=0.2)
    assert hits and hits[0]["title"] == "Purchase Approval Policy"
    assert hits[0]["similarity"] == max(h["similarity"] for h in hits)


def test_irrelevant_question_says_insufficient_and_skips_llm(tx_db, fake):
    r = rag.answer(tx_db, "What is a good recipe for chocolate cake?")
    assert r.reply == rag.NO_INFO and fake.calls == [] and r.retrieval == []


def test_rag_grounded_answer_with_real_citations(tx_db, fake):
    r = rag.answer(tx_db, "What is the approval threshold for purchases?")
    assert len(fake.calls) == 1 and "CONTEXT" in fake.calls[0][0] and "Purchase Approval Policy" in fake.calls[0][0]
    assert r.retrieval and all(c["document"] and 0 < c["similarity"] <= 1 for c in r.retrieval)
    titles = {d.title for d in tx_db.scalars(select(Document))}
    assert {c["document"] for c in r.retrieval} <= titles          # citations only reference real documents
    assert r.extra["cited_refs"] == [1]


def test_rag_without_llm_returns_passages_not_fabrication(tx_db):
    prov.set_provider_override(None)
    r = rag.answer(tx_db, "What is the approval threshold for purchases?")
    assert "No LLM provider is configured" in r.reply and "[1]" in r.reply and r.retrieval


# ---- upload API + worker
def test_upload_validation_via_api(client, auth):
    h = auth("buyer")
    r = client.post(f"{B}/documents", files={"file": ("evil.exe", b"MZ", "application/octet-stream")}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_upload"
    assert client.post(f"{B}/documents", files={"file": ("a.txt", b"hello world", "text/plain")}, data={"category": "bogus"}, headers=h).status_code == 422
    assert client.post(f"{B}/documents", files={"file": ("a.txt", b"hi", "text/plain")}, headers=auth("viewer")).status_code == 403


def test_upload_process_search_reprocess_delete(client, auth, tx_db, monkeypatch, tmp_path):
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "upload_dir", str(tmp_path))
    h = auth("buyer")
    body = b"Cold storage rule. Pallets of frozen goods must be moved to freezer bay within 30 minutes of arrival. Violations are reported to the warehouse supervisor."
    d = client.post(f"{B}/documents", files={"file": ("cold-storage.txt", body, "text/plain")}, data={"category": "procedure", "title": "Cold Storage Rule"}, headers=h)
    assert d.status_code == 201 and d.json()["status"] == "uploaded"
    did = d.json()["id"]
    assert tx_db.scalar(select(func.count()).select_from(DocumentProcessingJob).where(DocumentProcessingJob.document_id == did)) == 1
    assert os.listdir(tmp_path)  # stored on persistent upload dir
    n = docs.process_document(tx_db, did)
    assert n >= 1 and client.get(f"{B}/documents/{did}", headers=h).json()["status"] == "indexed"
    res = client.get(f"{B}/documents/search", params={"q": "how fast must frozen pallets be stored", "min_similarity": 0.2}, headers=h).json()["results"]
    assert res and res[0]["title"] == "Cold Storage Rule"
    assert client.post(f"{B}/documents/{did}/reprocess", headers=h).json()["status"] == "uploaded"
    assert client.get(f"{B}/documents/{did}/chunks", headers=h).json() == []  # chunks cleared until worker re-indexes
    assert client.delete(f"{B}/documents/{did}", headers=h).status_code == 204
    assert os.listdir(tmp_path) == [] and client.get(f"{B}/documents/{did}", headers=h).status_code == 404


def test_failed_processing_marks_document_failed(tx_db, monkeypatch, tmp_path):
    from app.core.config import get_settings
    from app.models import Organization, User
    p = tmp_path / "empty.txt"; p.write_text("   ")
    org = tx_db.scalar(select(Organization))
    d = Document(organization_id=org.id, title="empty", filename="empty.txt", file_type="txt", category="general", storage_path=str(p), size_bytes=3, status="uploaded")
    tx_db.add(d); tx_db.flush()
    with pytest.raises(Exception):
        docs.process_document(tx_db, d.id)
    tx_db.refresh(d)
    assert d.status == "failed" and "No extractable text" in d.error


# ---- generative
def test_generative_not_configured_is_explicit(client, auth):
    prov.set_provider_override(None)
    r = client.post(f"{B}/chatbots/generative/chat", json={"message": "Summarise our procurement position"}, headers=auth("viewer")).json()
    assert "No LLM provider is configured" in r["reply"] and not r["metadata"].get("data_sources")


def test_generative_uses_db_facts_and_history(client, auth, fake):
    h = auth("viewer")
    r1 = client.post(f"{B}/chatbots/generative/chat", json={"message": "Which products are low on stock?"}, headers=h).json()
    system, msgs = fake.calls[0]
    assert "DATABASE FACTS" in system and "Low-stock records" in system and "inventory" in r1["metadata"]["data_sources"]
    client.post(f"{B}/chatbots/generative/chat", json={"message": "and which supplier is fastest?", "session_id": r1["session_id"]}, headers=h)
    _, msgs2 = fake.calls[1]
    assert [m["role"] for m in msgs2] == ["user", "assistant", "user"] and msgs2[0]["content"] == "Which products are low on stock?"
    assert "Top suppliers by rating" in fake.calls[1][0]


def test_provider_error_surfaced(tx_db):
    from app.chatbot.generative.provider import ProviderError
    from app.chatbot.generative import engine as gen

    class Boom(FakeProvider):
        def complete(self, *a, **k): raise ProviderError("RateLimitError: slow down")
    prov.set_provider_override(Boom())
    try:
        assert "RateLimitError" in gen.answer(tx_db, "hello").reply
    finally:
        prov.set_provider_override(None)


def test_groq_provider_request_and_errors(monkeypatch):
    import httpx
    from app.chatbot.generative.provider import GroqProvider, ProviderError
    seen = {}

    def ok(url, json, headers, timeout):
        seen.update(url=url, body=json, auth=headers["Authorization"])
        return httpx.Response(200, json={"choices": [{"message": {"content": "hi"}}], "usage": {"prompt_tokens": 3, "completion_tokens": 1}})
    monkeypatch.setattr(httpx, "post", ok)
    r = GroqProvider("k", "m").complete("sys", [{"role": "user", "content": "q"}])
    assert r.text == "hi" and seen["body"]["messages"][0] == {"role": "system", "content": "sys"} and seen["url"].startswith("https://api.groq.com")
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(429, json={"error": {"message": "rate"}}))
    with pytest.raises(ProviderError, match="rate limit"):
        GroqProvider("k", "m").complete("s", [])
