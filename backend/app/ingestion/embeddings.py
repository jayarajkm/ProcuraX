"""Embedding providers. `local` (sentence-transformers, ~0.45 GB RAM per process) or hosted APIs (tiny RAM) for small servers.
The pgvector column is fixed at 384 dims by migration; a provider must return exactly EMBEDDING_DIM (checked on every call)."""
import time
from abc import ABC, abstractmethod
from app.core.config import get_settings


class EmbeddingError(Exception):
    pass


class Embedder(ABC):
    model_name: str
    dim: int

    @abstractmethod
    def embed(self, texts: list[str], kind: str = "document") -> list[list[float]]:
        """kind is 'document' or 'query' (some providers embed them differently)."""


class SentenceTransformerEmbedder(Embedder):
    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer
        self.model_name = model_name
        self.model = SentenceTransformer(model_name)
        self.dim = self.model.get_sentence_embedding_dimension()

    def embed(self, texts, kind="document"):
        return self.model.encode(texts, normalize_embeddings=True, batch_size=32, show_progress_bar=False).tolist()


class HostedEmbedder(Embedder):
    batch = 64
    url = ""

    def __init__(self, api_key: str, model: str, dim: int):
        if not api_key:
            raise EmbeddingError("EMBEDDING_API_KEY is not set (EMBEDDING_PROVIDER is a hosted provider).")
        self.api_key, self.dim = api_key, dim

    def _post(self, body: dict) -> dict:
        import httpx
        last = ""
        for attempt in range(3):
            try:
                r = httpx.post(self.url, json=body, headers={"Authorization": f"Bearer {self.api_key}"}, timeout=40.0)
            except httpx.HTTPError as e:
                last = type(e).__name__
                time.sleep(1 + attempt * 2); continue
            if r.status_code == 200:
                return r.json()
            last = f"HTTP {r.status_code}: {r.text[:200]}"
            if r.status_code not in (429, 500, 502, 503):
                break
            time.sleep(2 + attempt * 4)
        raise EmbeddingError(f"Embedding API failed ({last})")

    def _check(self, vecs):
        for v in vecs:
            if len(v) != self.dim:
                raise EmbeddingError(f"Embedding model returned {len(v)} dimensions but the database column is fixed at {self.dim}. "
                                     "Choose a model/dimension of 384 (or add a migration).")
        return vecs

    def embed(self, texts, kind="document"):
        out = []
        for i in range(0, len(texts), self.batch):
            out += self._embed_batch(texts[i:i + self.batch], kind)
        return self._check(out)

    @abstractmethod
    def _embed_batch(self, texts, kind): ...


class OpenAICompatibleEmbedder(HostedEmbedder):
    def __init__(self, api_key, model, dim, base_url):
        super().__init__(api_key, model, dim)
        self.model, self.model_name, self.url = model, f"openai:{model}", base_url.rstrip("/") + "/embeddings"

    def _embed_batch(self, texts, kind):
        body = {"model": self.model, "input": texts, "encoding_format": "float"}
        if self.model.startswith("text-embedding-3"):  # these models can return shortened vectors
            body["dimensions"] = self.dim
        d = self._post(body)
        return [x["embedding"] for x in sorted(d["data"], key=lambda x: x["index"])]


class CohereEmbedder(HostedEmbedder):
    batch = 96
    url = "https://api.cohere.com/v2/embed"

    def __init__(self, api_key, model, dim):
        super().__init__(api_key, model, dim)
        self.model, self.model_name = model, f"cohere:{model}"

    def _embed_batch(self, texts, kind):
        d = self._post({"model": self.model, "texts": texts, "embedding_types": ["float"],
                        "input_type": "search_query" if kind == "query" else "search_document"})
        return d["embeddings"]["float"]


_embedder: Embedder | None = None


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        s = get_settings()
        if s.embedding_provider == "local":
            _embedder = SentenceTransformerEmbedder(s.embedding_model)
            if _embedder.dim != s.embedding_dim:
                raise RuntimeError(f"Embedding model dim {_embedder.dim} != configured {s.embedding_dim}; schema column is fixed by migration.")
        elif s.embedding_provider == "openai":
            _embedder = OpenAICompatibleEmbedder(s.embedding_api_key, s.embedding_model, s.embedding_dim, s.embedding_base_url)
        elif s.embedding_provider == "cohere":
            _embedder = CohereEmbedder(s.embedding_api_key, s.embedding_model, s.embedding_dim)
        else:
            raise EmbeddingError(f"Unknown EMBEDDING_PROVIDER '{s.embedding_provider}' (local | openai | cohere)")
    return _embedder


def set_embedder(e: Embedder | None):
    global _embedder
    _embedder = e
