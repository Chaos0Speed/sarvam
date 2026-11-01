# Ghar Ka Doctor ("Parchi-se-Puchho")

An interactive lab-report & prescription storyteller with a grounded voice
doubt solver. Point it at a lab report + prescription (or use a bundled
demo case), get a visual "Lab → Pill" storyboard with morning/afternoon/night
cards, then hold the mic and ask real-life doubts in 22 Indian languages
or Hinglish — answered strictly against the patient's own report.

> ⚠️ Demo for patient education only. Not medical advice. It never changes
> doses — doubts about changing anything are flagged "Consult doctor".

## Run

```bash
cd sarvam
.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000
# open http://localhost:8000
```

The API key is read from `.env` (`SARVAM_API_KEY=`) — never hardcode it.

## Sarvam stack

| Layer | API |
|---|---|
| Report/prescription OCR | Sarvam Vision (`doc_ai.parse`, printed/handwritten/mixed) |
| Storyboard + doubt answers | `sarvam-105b` (strict-JSON, grounded prompts) |
| Spoken doubts | Saaras v4 (`saaras:v4`, `mode=codemix`) |
| Spoken replies | Bulbul v3 (`bulbul:v3`) |

## Languages

- Speech-to-text + answers: all 23 codes (22 Indian languages + English).
- Voice replies: Bulbul supports 11 — for the rest the UI degrades to
  text-only with a note (see `languages.py`).

## Endpoints

- `GET /` — single-screen UI (audio 🔊 buttons on labs, medicines, guardrails, doubts)
- `GET /api/languages` — language registry
- `GET /api/presets` — bundled demo cases
- `POST /api/analyze-report` — `multipart/form-data`: `preset_id` or `file`, `language_code`
- `POST /api/ask-doubt` — JSON: `report_id`, `language_code`, `question` **or** `audio_base64`+`audio_mime`
- `POST /api/translate-samples` — JSON: `texts`, `language_code`
- `POST /api/speak` — JSON: `text`, `language_code` → base64 mp3 (powers the UI audio buttons)

## Deploy (free)

**Render (recommended):** this repo ships a `render.yaml` blueprint.

1. Push the repo to GitHub.
2. On [render.com](https://render.com) → **New +** → **Blueprint** → pick the repo.
3. When prompted, set the `SARVAM_API_KEY` environment variable (never commit it).
4. Deploy. Free tier gives HTTPS + a live URL; it sleeps after ~15 min idle
   (first visit after a nap takes ~30 s to wake).

**Docker anywhere:** a `Dockerfile` is included — works on Render, Fly.io,
Railway, Koyeb, or Hugging Face Spaces (Docker space). The app binds to
`$PORT` where set.

## Notes for production

- CORS is open for the demo — restrict `allow_origins` before going public.
- Report context is stored in memory (`REPORTS` in `app.py`) — swap for
  Redis/DB for multi-worker deployments.
- Uploaded documents are processed in memory and never written to disk.
