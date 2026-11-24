"""RAG chatbot: retrieve (pgvector) -> ground -> generate. Citations come from retrieval metadata, never from LLM text."""
import re
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.chatbot.generative.provider import ProviderError, ProviderNotConfigured, get_provider
from app.chatbot.types import ChatResult
from app.models import PromptTemplate
from app.services import documents as docs

NO_INFO = "The uploaded knowledge base does not contain sufficient information to answer this question."


def answer(db: Session, message: str, history=None, top_k: int = 4, min_similarity: float = 0.30, **_) -> ChatResult:
    hits = docs.search_chunks(db, message, top_k=top_k, min_similarity=min_similarity)
    steps = [f"Embedded the question and searched pgvector (top_k={top_k}, min similarity {min_similarity})", f"{len(hits)} chunk(s) passed the threshold"]
    cites = [{"ref": i + 1, "document": h["title"], "document_id": str(h["document_id"]), "page": h["page"], "chunk_index": h["chunk_index"],
              "similarity": h["similarity"], "excerpt": h["content"][:300]} for i, h in enumerate(hits)]
    base = dict(data_sources=["documents", "document_chunks (pgvector)"], retrieval=cites)
    if not hits:
        return ChatResult(reply=NO_INFO, approach="RAG: retrieval found nothing above the similarity threshold; no LLM call made", steps=steps, **base)
    try:
        provider = get_provider()
    except ProviderNotConfigured as e:
        listing = "\n".join(f"[{c['ref']}] {c['document']}: {c['excerpt']}" for c in cites)
        return ChatResult(reply=f"{e}\n\nRetrieval worked, so here are the most relevant passages instead:\n{listing}",
                          approach="RAG: retrieval only (LLM not configured)", steps=steps + ["LLM skipped: provider not configured"], **base)
    ctx = "\n\n".join(f"[{c['ref']}] ({c['document']}{', page ' + str(c['page']) if c['page'] else ''})\n{h['content']}" for c, h in zip(cites, hits))
    tmpl = db.scalar(select(PromptTemplate.template).where(PromptTemplate.name == "rag_system"))
    try:
        r = provider.complete(f"{tmpl}\n\nCONTEXT:\n{ctx}", [{"role": "user", "content": message}], max_tokens=800)
    except ProviderError as e:
        return ChatResult(reply=f"The LLM provider returned an error: {e}", approach="RAG: provider error", steps=steps, **base)
    used = sorted({int(n) for n in re.findall(r"\[(\d+)\]", r.text) if 1 <= int(n) <= len(cites)})
    return ChatResult(reply=r.text, approach=f"RAG: pgvector retrieval -> grounded LLM ({provider.name}:{r.model})", steps=steps + ["Sent retrieved passages to the LLM with a grounding prompt"],
                      extra={"cited_refs": used, "model": r.model}, **base)
