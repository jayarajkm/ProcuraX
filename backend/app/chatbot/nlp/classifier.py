"""Replaceable intent classification. Baseline: TF-IDF cosine similarity to labelled example phrases."""
from abc import ABC, abstractmethod
from dataclasses import dataclass
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from app.chatbot.nlp.preprocess import normalise


@dataclass
class IntentPrediction:
    intent: str | None
    score: float
    ranking: list[tuple[str, float]]


class IntentClassifier(ABC):
    @abstractmethod
    def fit(self, examples: list[tuple[str, str]]) -> "IntentClassifier": ...
    @abstractmethod
    def predict(self, text: str) -> IntentPrediction: ...


class TfidfIntentClassifier(IntentClassifier):
    def __init__(self, threshold: float = 0.30):
        self.threshold = threshold

    def fit(self, examples):
        self.labels = [l for l, _ in examples]
        self.vec = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True)
        self.matrix = self.vec.fit_transform([normalise(t) for _, t in examples])
        return self

    def predict(self, text):
        norm = normalise(text)
        if not norm:
            return IntentPrediction(None, 0.0, [])
        sims = cosine_similarity(self.vec.transform([norm]), self.matrix)[0]
        best: dict[str, float] = {}
        for lab, s in zip(self.labels, sims):
            best[lab] = max(best.get(lab, 0.0), float(s))
        ranking = sorted(best.items(), key=lambda kv: -kv[1])
        top, score = ranking[0]
        return IntentPrediction(top if score >= self.threshold else None, round(score, 3), [(k, round(v, 3)) for k, v in ranking[:3]])
