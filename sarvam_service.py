"""Thin wrappers around the Sarvam SDK used by Ghar Ka Doctor.

All calls go through one shared client; the API key is read from the
environment (loaded from .env) and is never logged or hardcoded.
"""

import base64
import io
import json
import os
import re
import time
import zipfile
from pathlib import Path

import httpx
from sarvamai import SarvamAI

from languages import LANGUAGES, language_name

_BASE_DIR = Path(__file__).resolve().parent
_client: SarvamAI | None = None

_STT_CODECS = {
    "webm", "mp3", "wav", "ogg", "opus", "mp4", "m4a",
    "aac", "flac", "amr", "aiff", "wma",
}


def load_env(path: Path = _BASE_DIR / ".env") -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def get_client() -> SarvamAI:
    global _client
    if _client is None:
        load_env()
        api_key = os.environ.get("SARVAM_API_KEY")
        if not api_key:
            raise RuntimeError(
                "SARVAM_API_KEY is not set. Paste your key into the .env file."
            )
        _client = SarvamAI(api_subscription_key=api_key)
    return _client


def extract_json(text: str) -> dict | list:
    """Best-effort extraction of the first JSON object/array from an LLM reply."""
    text = (text or "").strip()
    fence = re.match(r"^```[a-zA-Z]*\s*(.*?)\s*```$", text, flags=re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        for pattern in (r"\{.*\}", r"\[.*\]"):
            match = re.search(pattern, text, flags=re.S)
            if match:
                return json.loads(match.group(0))
        raise


def chat_text(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.2,
    max_tokens: int = 3000,
) -> str:
    """Chat completion returning the raw reply text.

    Uses sarvam-105b-conversations: the 105b reasoning variant spends its
    token budget and wall-clock time on hidden reasoning before answering
    (empty content / finish_reason="length" / read timeouts), while the
    conversations variant answers directly — the right fit for an
    interactive doubt loop.
    """
    response = get_client().chat.completions(
        model="sarvam-105b-conversations",
        temperature=temperature,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    choice = response.choices[0]
    content = choice.message.content or ""
    if not content.strip():
        raise RuntimeError(
            f"Model returned empty content (finish_reason={choice.finish_reason})"
        )
    return content


def chat_json(system_prompt: str, user_prompt: str, temperature: float = 0.2) -> dict | list:
    return extract_json(
        chat_text(system_prompt, user_prompt, temperature=temperature)
    )


def speak(text: str, language_code: str) -> str | None:
    """Return base64 mp3 for `text`, or None when the language has no TTS voice."""
    info = LANGUAGES.get(language_code, {})
    if not info.get("tts") or not text:
        return None
    response = get_client().text_to_speech.convert(
        text=text[:2400],
        language_code=language_code,
        speaker=info.get("speaker") or "anushka",
        model="bulbul:v3",
        output_audio_codec="mp3",
        enable_preprocessing=True,
    )
    audios = getattr(response, "audios", None)
    if not audios:
        return None
    audio = audios[0]
    if isinstance(audio, bytes):
        return base64.b64encode(audio).decode("ascii")
    return audio  # API already returns base64 strings


def transcribe(data: bytes, filename: str, mime: str, language_code: str) -> str:
    """Speech-to-text with codemix mode — English words stay in English."""
    ext = (mime or "").split("/")[-1].split(";")[0].lower()
    if ext not in _STT_CODECS:
        ext = "wav"
    response = get_client().speech_to_text.transcribe(
        file=(filename, data, mime or "audio/webm"),
        model="saaras:v4",
        mode="codemix",
        language_code=language_code,
        input_audio_codec=ext,
    )
    return (getattr(response, "transcript", "") or "").strip()


def ocr_document(data: bytes, filename: str, mime: str, language_code: str) -> str:
    """Digitise a lab report / prescription (photo or PDF) via Sarvam Vision."""
    client = get_client()
    job = client.doc_ai.parse(
        file=[(filename, io.BytesIO(data), mime or "application/pdf")],
        language=language_code,
        content_type="mixed",
    )
    deadline = time.time() + 120
    while time.time() < deadline:
        status = client.doc_ai.get_status(job_id=job.job_id)
        state = (getattr(status, "status", "") or "").lower()
        if state in {"completed", "partially_completed"}:
            break
        if state in {"failed", "rejected"}:
            raise RuntimeError(f"Document OCR failed ({state}). Try a clearer photo.")
        time.sleep(3)
    else:
        raise RuntimeError("OCR timed out. Try a preset case or a clearer photo.")

    dl = client.doc_ai.get_download_url(job_id=job.job_id)
    resp = httpx.get(
        dl.url,
        headers=dict(getattr(dl, "headers", None) or {}),
        timeout=60,
        follow_redirects=True,
    )
    resp.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith((".md", ".html"))]
        if not names:
            raise RuntimeError("OCR returned no readable output.")
        return zf.read(names[0]).decode("utf-8", errors="replace")
