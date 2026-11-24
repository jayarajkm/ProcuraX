"""Multilingual support. LLM bots answer in the selected language natively; deterministic bots (rule/NLP/ML) run in English
and use the LLM only as a translation layer (question -> English, reply -> selected language). Always disclosed in metadata."""
from app.chatbot.generative.provider import get_provider

# code, English name, native name, right-to-left
LANGUAGES = [
    ("en", "English", "English", False), ("hi", "Hindi", "हिन्दी", False), ("es", "Spanish", "Español", False), ("fr", "French", "Français", False),
    ("de", "German", "Deutsch", False), ("pt", "Portuguese", "Português", False), ("ar", "Arabic", "العربية", True),
    ("zh", "Chinese (Simplified)", "简体中文", False), ("ja", "Japanese", "日本語", False), ("ko", "Korean", "한국어", False),
    ("ru", "Russian", "Русский", False), ("ta", "Tamil", "தமிழ்", False), ("te", "Telugu", "తెలుగు", False), ("bn", "Bengali", "বাংলা", False),
]
_BY_CODE = {c: n for c, n, _, _ in LANGUAGES}


def is_valid(code: str) -> bool:
    return code in _BY_CODE


def language_name(code: str) -> str:
    return _BY_CODE[code]


def instruction(code: str) -> str:
    if code == "en":
        return ""
    return (f"\n\nLANGUAGE: Write your entire answer in {language_name(code)}, even if the user wrote in another language. "
            "Keep identifiers (PO numbers, REQ numbers, SKUs, supplier codes), numbers, currency amounts, units and markdown symbols unchanged.")


def translate(text: str, target_name: str) -> str:
    """Translate via the configured LLM. Raises ProviderNotConfigured / ProviderError (callers degrade gracefully)."""
    if not text.strip():
        return text
    system = (f"You are a professional translator for procurement software. Translate the user's text into {target_name}. "
              "Output ONLY the translation, with no notes or quotes. Do not translate or alter identifiers such as PO-2025074, REQ-00012, "
              "SKU codes like FAS-0001, supplier codes like SUP-003, numbers, or markdown symbols.")
    return get_provider().complete(system, [{"role": "user", "content": text}], max_tokens=min(1500, 200 + len(text)), temperature=0).text.strip()
