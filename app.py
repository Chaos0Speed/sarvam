"""Ghar Ka Doctor ("Parchi-se-Puchho") — FastAPI backend.

Lab report + prescription → visual storyboard + grounded voice doubt solving,
powered by the Sarvam AI stack: Sarvam Vision (OCR), sarvam-105b (reasoning),
Saaras (STT) and Bulbul (TTS).

Demo store is in-memory; swap REPORTS for Redis/DB before real deployment.
"""

import base64
import json
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import sarvam_service as svc
from languages import DEFAULT_LANGUAGE, LANGUAGES, language_name
from presets import PRESETS

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="Ghar Ka Doctor (Parchi-se-Puchho)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten before public deployment
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")

REPORTS: dict[str, dict] = {}

EXTRACTION_SYSTEM = """You are "Ghar Ka Doctor", a careful patient-education assistant for Indian patients.
You receive OCR text from a lab report and/or prescription and build a simple visual storyboard.

STRICT RULES:
- Use ONLY facts present in the text. Never invent labs, medicines, doses or values.
- Do not diagnose. Do not judge or second-guess the doctor's choices.
- LANGUAGE IS CRITICAL: write ALL patient-facing text (patient_summary, plain_meaning, schedule labels/instructions/notes, guardrails, story_script) in {language} using its NATIVE script. NEVER use English or romanized text for these fields — only medicine names and lab marker names may stay in English.

Return ONLY valid JSON with exactly this shape:
{{
  "patient_summary": "one sentence about who this report belongs to",
  "lab_links": [
    {{"marker": "HbA1c", "value": "8.2 %", "status": "high|low|borderline|normal",
      "reference_range": "4.0-5.6 %", "linked_medicine": "Tab Glycomet GP 1",
      "plain_meaning": "what this number means in everyday words"}}
  ],
  "schedule": {{
    "morning": {{"label": "when, e.g. Empty stomach", "pills": [{{"name": "verbatim medicine name", "instruction": "how and when to take it", "note": "one practical kitchen-level guardrail"}}]}},
    "afternoon": {{"label": "...", "pills": []}},
    "night": {{"label": "...", "pills": []}}
  }},
  "guardrails": ["short do/don't lines an Indian grandmother would understand"],
  "story_script": "a warm 30-second spoken summary (max 450 characters), like a family doctor explaining the routine"
}}

Storyboard rules:
- lab_links: include every abnormal or borderline marker; set linked_medicine to the medicine treating it, or null if none.
- schedule: place EVERY medicine from the prescription (prefix SOS medicines' instruction with "SOS: ").
- story_script: mention the top 1-2 actions, end reassuringly, and remind the patient to follow their doctor."""

DOUBT_SYSTEM = """You are "Ghar Ka Doctor", a careful patient-education assistant. You answer one patient doubt using ONLY the provided report/prescription context.

HARD SAFETY RULES:
- NEVER advise starting, stopping, skipping or changing any medicine or dose. If the doubt implies that, safety_level MUST be "doctor" and you must tell the patient to ask their doctor before changing anything.
- Never diagnose new conditions. Never suggest new medicines. General food/timing lifestyle information is allowed with care.
- Use only facts from the context. If the context does not cover the doubt, share only widely-known general information and set safety_level to at least "caution".
- answer_text: maximum 80 words, simple everyday words, warm tone, ALWAYS written in {language} using its NATIVE script — never English, never romanized (medicine names may stay in English). If safety_level is not "safe", end by advising the patient to confirm with their doctor.

Return ONLY valid JSON:
{{"safety_level": "safe|caution|doctor",
 "checked_pill": "the medicine you checked, or null",
 "checked_lab": "the lab value you checked, or null",
 "misconception_spotted": "the wrong belief found in the doubt, or null",
 "answer_text": "..."}}"""

TRANSLATE_SYSTEM = """You translate patient doubts. Input is JSON with "language" and "texts" (Hinglish doubts).
Return natural, spoken-style translations in that language; code-mixed style is fine and medical words may stay in English.
Output ONLY a JSON object of the form {"translations": ["translation 1", "translation 2", ...]} with exactly one item per input text — no commentary, no code fences, nothing outside the JSON."""


def _require_language(code: str, allow_unknown: bool = False) -> None:
    if code == "unknown" and allow_unknown:
        return
    if code not in LANGUAGES:
        raise HTTPException(status_code=400, detail=f"Unsupported language: {code}")


@app.get("/")
def index() -> FileResponse:
    # no-cache: the HTML must never go stale against versioned static assets
    return FileResponse(
        BASE_DIR / "static" / "index.html",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/api/languages")
def list_languages() -> dict:
    return {"default": DEFAULT_LANGUAGE, "languages": LANGUAGES}


@app.get("/api/presets")
def list_presets() -> list[dict]:
    return [
        {
            "id": p["id"],
            "title": p["title"],
            "description": p["description"],
            "sample_doubts": p["sample_doubts"],
        }
        for p in PRESETS.values()
    ]


@app.post("/api/analyze-report")
async def analyze_report(
    language_code: str = Form(DEFAULT_LANGUAGE),
    preset_id: str | None = Form(None),
    file: UploadFile | None = File(None),
) -> dict:
    _require_language(language_code)

    if preset_id:
        preset = PRESETS.get(preset_id)
        if not preset:
            raise HTTPException(status_code=404, detail=f"Unknown preset: {preset_id}")
        context_text = preset["raw_text"]
        source = f"preset:{preset_id}"
    elif file is not None:
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Empty file.")
        context_text = await _ocr(file, data, language_code)
        source = "upload"
    else:
        raise HTTPException(status_code=400, detail="Provide a preset_id or a file.")

    try:
        story = svc.chat_json(
            EXTRACTION_SYSTEM.format(language=language_name(language_code)),
            f"REMINDER: every patient-facing field must be written in "
            f"{language_name(language_code)}, native script.\n\n{context_text}",
            temperature=0.2,
        )
    except Exception as exc:  # noqa: BLE001 - surface a clean demo error
        raise HTTPException(status_code=502, detail=f"Analysis failed: {exc}") from exc

    # Belt-and-braces: if the model still drifted to English, translate the
    # spoken overview so the audio is always in the chosen language.
    story["story_script"] = svc.ensure_language(
        story.get("story_script", ""), language_code
    )

    report_id = uuid.uuid4().hex[:12]
    REPORTS[report_id] = {
        "context_text": context_text,
        "story": story,
        "language_code": language_code,
    }

    try:
        audio = svc.speak(story.get("story_script", ""), language_code)
    except Exception:  # noqa: BLE001 - storyboard still works without audio
        audio = None

    return {
        "report_id": report_id,
        "source": source,
        "language_code": language_code,
        "tts_available": LANGUAGES[language_code]["tts"],
        "story": story,
        "audio_base64": audio,
    }


async def _ocr(file: UploadFile, data: bytes, language_code: str) -> str:
    mime = file.content_type or "application/pdf"
    if not (mime.startswith("image/") or mime == "application/pdf"):
        raise HTTPException(status_code=400, detail="Upload an image or PDF.")
    try:
        return svc.ocr_document(data, file.filename or "report", mime, language_code)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"OCR failed: {exc}") from exc


class AskDoubtRequest(BaseModel):
    report_id: str
    language_code: str = DEFAULT_LANGUAGE
    question: str | None = None
    audio_base64: str | None = None
    audio_mime: str = "audio/webm"


@app.post("/api/ask-doubt")
async def ask_doubt(req: AskDoubtRequest) -> dict:
    _require_language(req.language_code, allow_unknown=True)
    report = REPORTS.get(req.report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Generate a storyboard first.")

    question = (req.question or "").strip()
    detected = None
    if req.audio_base64:
        try:
            data = base64.b64decode(req.audio_base64)
            # "unknown" lets Saaras auto-detect the spoken language.
            question, detected = svc.transcribe(
                data, "doubt.webm", req.audio_mime, req.language_code
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"Speech-to-text failed: {exc}") from exc
    if not question:
        raise HTTPException(status_code=400, detail="No question heard. Speak or type a doubt.")

    # Answer in the detected language for voice doubts; a typed doubt with
    # auto-detect selected falls back to the report's language.
    if req.language_code != "unknown":
        answer_lang = req.language_code
    else:
        answer_lang = detected or report.get("language_code") or "en-IN"
        if answer_lang not in LANGUAGES:
            answer_lang = "en-IN"

    try:
        answer = svc.chat_json(
            DOUBT_SYSTEM.format(language=language_name(answer_lang)),
            f"REMINDER: answer_text must be written in "
            f"{language_name(answer_lang)}, native script.\n\n"
            f"CONTEXT:\n{report['context_text']}\n\nPATIENT'S DOUBT: {question}",
            temperature=0.4,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Doubt answering failed: {exc}") from exc

    # Guarantee the spoken answer is in the patient's language.
    answer["answer_text"] = svc.ensure_language(
        answer.get("answer_text", ""), answer_lang
    )

    try:
        audio = svc.speak(answer.get("answer_text", ""), answer_lang)
    except Exception:  # noqa: BLE001 - answer still works without audio
        audio = None

    return {
        "transcript": question,
        "answer": answer,
        "answer_language": answer_lang,
        "detected_language": answer_lang if req.language_code == "unknown" else None,
        "tts_available": LANGUAGES[answer_lang]["tts"],
        "audio_base64": audio,
    }


class TranslateRequest(BaseModel):
    texts: list[str]
    language_code: str = DEFAULT_LANGUAGE


@app.post("/api/translate-samples")
async def translate_samples(req: TranslateRequest) -> dict:
    _require_language(req.language_code)
    if not req.texts:
        return {"translations": []}
    payload = json.dumps(
        {"language": language_name(req.language_code), "texts": req.texts},
        ensure_ascii=False,
    )
    translations = None
    try:
        raw = svc.chat_text(TRANSLATE_SYSTEM, payload, temperature=0.2)
    except Exception as exc:  # noqa: BLE001
        print(f"translate-samples: model call failed: {exc}", flush=True)
        raw = None
    if raw:
        try:
            out = svc.extract_json(raw)
            if isinstance(out, dict):
                translations = out.get("translations")
            elif isinstance(out, list):
                translations = out
        except Exception as exc:  # noqa: BLE001
            print(f"translate-samples: parse failed ({exc})", flush=True)
            # The model sometimes replies with the bare translation instead
            # of JSON — for a single text that plain reply IS the translation.
            cleaned = raw.strip().strip("`").strip()
            if len(req.texts) == 1 and cleaned and "\n" not in cleaned:
                translations = [cleaned]
    if not isinstance(translations, list) or len(translations) != len(req.texts):
        translations = req.texts
    return {"translations": translations}


class SpeakRequest(BaseModel):
    text: str
    language_code: str = DEFAULT_LANGUAGE


@app.post("/api/speak")
async def speak_text(req: SpeakRequest) -> dict:
    """Text-to-speech for any UI element (audio buttons everywhere)."""
    _require_language(req.language_code)
    text = req.text.strip()[:2400]
    tts_available = LANGUAGES[req.language_code]["tts"]
    if not text or not tts_available:
        return {"audio_base64": None, "tts_available": tts_available}
    try:
        # Every 🔊 button speaks the CHOSEN language — if the source text is
        # UI chrome or drifted to English, translate it first.
        spoken_text = svc.ensure_language(text, req.language_code)
        audio = svc.speak(spoken_text, req.language_code)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Text-to-speech failed: {exc}") from exc
    return {"audio_base64": audio, "tts_available": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
