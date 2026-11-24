from abc import ABC, abstractmethod
from app.core.config import get_settings


class Embedder(ABC):
    model_name: str
    dim: int

    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]: ...


class SentenceTransformerEmbedder(Embedder):
    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer
        self.model_name = model_name
        self.model = SentenceTransformer(model_name)
        self.dim = self.model.get_sentence_embedding_dimension()

    def embed(self, texts):
        return self.model.encode(texts, normalize_embeddings=True, batch_size=32, show_progress_bar=False).tolist()


_embedder: Embedder | None = None


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        s = get_settings()
        _embedder = SentenceTransformerEmbedder(s.embedding_model)
        if _embedder.dim != s.embedding_dim:
            raise RuntimeError(f"Embedding model dim {_embedder.dim} != configured {s.embedding_dim}; schema column is fixed by migration.")
    return _embedder


def set_embedder(e: Embedder | None):
    global _embedder
    _embedder = e
