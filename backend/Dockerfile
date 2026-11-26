FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Local embeddings (RAG): CPU-only torch. Skip with --build-arg LOCAL_EMBEDDINGS=0 and use a hosted EMBEDDING_PROVIDER (saves ~0.45 GB RAM/process, ~1.8 GB disk).
ARG LOCAL_EMBEDDINGS=1
RUN if [ "$LOCAL_EMBEDDINGS" = "1" ]; then \
      pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu && pip install --no-cache-dir sentence-transformers==3.3.1; \
    fi
ENV HF_HOME=/data/models/hf
COPY . .
RUN useradd -u 1000 -m app && mkdir -p /data/uploads /data/models/hf && chown -R 1000:1000 /data
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
