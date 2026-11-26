import subprocess
import sys
import httpx
import pytest
from sqlalchemy import select
from app.ingestion import embeddings as E
from app.ingestion.embeddings import CohereEmbedder, EmbeddingError, OpenAICompatibleEmbedder
from app.models import Document, DocumentChunk
from app.services import documents as docs


def test_api_startup_does_not_load_heavy_libraries():
    """Memory guard for 1 GB servers: importing the app must not pull in pandas/scikit-learn/torch."""
    code = "import sys, app.main; bad=[m for m in ('pandas','sklearn','scipy','torch','sentence_transformers') if m in sys.modules]; print('BAD:' + ','.join(bad))"
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=".").stdout
    assert out.strip() == "BAD:", out


def _resp(vecs, key="data"):
    return httpx.Response(200, json={"data": [{"index": i, "embedding": v} for i, v in enumerate(vecs)]})


def test_openai_compatible_request_shape_and_dimensions(monkeypatch):
    seen = {}

    def post(url, json, headers, timeout):
        seen.update(url=url, body=json, auth=headers["Authorization"]); return _resp([[0.1] * 384 for _ in json["input"]])
    monkeypatch.setattr(httpx, "post", post)
    e = OpenAICompatibleEmbedder("k", "text-embedding-3-small", 384, "https://api.openai.com/v1/")
    out = e.embed(["a", "b"], "query")
    assert len(out) == 2 and seen["url"] == "https://api.openai.com/v1/embeddings" and seen["body"]["dimensions"] == 384 and e.model_name == "openai:text-embedding-3-small"


def test_openai_batches_large_inputs(monkeypatch):
    calls = []
    monkeypatch.setattr(httpx, "post", lambda url, json, headers, timeout: (calls.append(len(json["input"])), _resp([[0.0] * 384 for _ in json["input"]]))[1])
    OpenAICompatibleEmbedder("k", "m", 384, "http://x").embed([str(i) for i in range(150)])
    assert calls == [64, 64, 22]


def test_cohere_input_type_by_kind(monkeypatch):
    seen = []
    monkeypatch.setattr(httpx, "post", lambda url, json, headers, timeout: (seen.append(json["input_type"]), httpx.Response(200, json={"embeddings": {"float": [[0.2] * 384]}}))[1])
    e = CohereEmbedder("k", "embed-multilingual-light-v3.0", 384)
    e.embed(["x"], "document"); e.embed(["x"], "query")
    assert seen == ["search_document", "search_query"] and e.model_name.startswith("cohere:")


def test_wrong_dimension_is_rejected_loudly(monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _resp([[0.1] * 1536]))
    with pytest.raises(EmbeddingError, match="fixed at 384"):
        OpenAICompatibleEmbedder("k", "m", 384, "http://x").embed(["a"])


def test_api_errors_do_not_leak_key_and_retry_only_transient(monkeypatch):
    import time
    monkeypatch.setattr(time, "sleep", lambda s: None)
    n = {"c": 0}
    monkeypatch.setattr(httpx, "post", lambda *a, **k: (n.__setitem__("c", n["c"] + 1), httpx.Response(401, text="bad key"))[1])
    with pytest.raises(EmbeddingError) as ei:
        OpenAICompatibleEmbedder("SECRETKEY123", "m", 384, "http://x").embed(["a"])
    assert "SECRETKEY123" not in str(ei.value) and n["c"] == 1          # 401 is not retried
    n["c"] = 0
    monkeypatch.setattr(httpx, "post", lambda *a, **k: (n.__setitem__("c", n["c"] + 1), httpx.Response(429, text="slow"))[1])
    with pytest.raises(EmbeddingError):
        OpenAICompatibleEmbedder("k", "m", 384, "http://x").embed(["a"])
    assert n["c"] == 3                                                   # 429 retried


def test_missing_key_is_explicit():
    with pytest.raises(EmbeddingError, match="EMBEDDING_API_KEY"):
        OpenAICompatibleEmbedder("", "m", 384, "http://x")


def test_search_refuses_vectors_from_a_different_model(tx_db):
    class Other(E.Embedder):
        model_name, dim = "openai:other-model", 384
        def embed(self, texts, kind="document"): return [[0.1] * 384 for _ in texts]
    E.set_embedder(Other())
    try:
        with pytest.raises(EmbeddingError, match="different embedding model"):
            docs.search_chunks(tx_db, "approval threshold")
    finally:
        E.set_embedder(None)


def test_documents_search_api_reports_503_when_embedding_down(client, auth):
    class Down(E.Embedder):
        model_name, dim = "sentence-transformers/all-MiniLM-L6-v2", 384
        def embed(self, texts, kind="document"): raise EmbeddingError("provider offline")
    E.set_embedder(Down())
    try:
        r = client.get("/api/v1/documents/search", params={"q": "approval"}, headers=auth("viewer"))
        assert r.status_code == 503 and r.json()["error"]["code"] == "embedding_unavailable"
        c = client.post("/api/v1/chatbots/rag/chat", json={"message": "approval threshold"}, headers=auth("viewer")).json()
        assert "embedding service is unavailable" in c["reply"]
    finally:
        E.set_embedder(None)
