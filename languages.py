"""Language registry for Ghar Ka Doctor.

Speech-to-Text (Saaras v4) and chat support all 23 codes below
(22 Indian languages + English). Text-to-Speech (Bulbul) voices
exist only for the 11 languages flagged `tts: true` — for the rest
the app degrades gracefully to text-only answers.
"""

LANGUAGES = {
    "hi-IN": {"name": "Hindi", "native": "हिन्दी", "tts": True, "speaker": "ritu"},
    "en-IN": {"name": "English (India)", "native": "English", "tts": True, "speaker": "ritu"},
    "bn-IN": {"name": "Bengali", "native": "বাংলা", "tts": True, "speaker": "ritu"},
    "ta-IN": {"name": "Tamil", "native": "தமிழ்", "tts": True, "speaker": "ritu"},
    "te-IN": {"name": "Telugu", "native": "తెలుగు", "tts": True, "speaker": "ritu"},
    "mr-IN": {"name": "Marathi", "native": "मराठी", "tts": True, "speaker": "ritu"},
    "gu-IN": {"name": "Gujarati", "native": "ગુજરાતી", "tts": True, "speaker": "ritu"},
    "kn-IN": {"name": "Kannada", "native": "ಕನ್ನಡ", "tts": True, "speaker": "ritu"},
    "ml-IN": {"name": "Malayalam", "native": "മലയാളം", "tts": True, "speaker": "ritu"},
    "pa-IN": {"name": "Punjabi", "native": "ਪੰਜਾਬੀ", "tts": True, "speaker": "ritu"},
    "od-IN": {"name": "Odia", "native": "ଓଡ଼ିଆ", "tts": True, "speaker": "ritu"},
    "as-IN": {"name": "Assamese", "native": "অসমীয়া", "tts": False, "speaker": None},
    "ur-IN": {"name": "Urdu", "native": "اردو", "tts": False, "speaker": None},
    "ne-IN": {"name": "Nepali", "native": "नेपाली", "tts": False, "speaker": None},
    "kok-IN": {"name": "Konkani", "native": "कोंकणी", "tts": False, "speaker": None},
    "ks-IN": {"name": "Kashmiri", "native": "کٲشُر", "tts": False, "speaker": None},
    "sd-IN": {"name": "Sindhi", "native": "سنڌي", "tts": False, "speaker": None},
    "sa-IN": {"name": "Sanskrit", "native": "संस्कृतम्", "tts": False, "speaker": None},
    "sat-IN": {"name": "Santali", "native": "ᱥᱟᱱᱛᱟᱲᱤ", "tts": False, "speaker": None},
    "mni-IN": {"name": "Manipuri", "native": "ꯃꯤꯇꯩꯂꯣꯟ", "tts": False, "speaker": None},
    "brx-IN": {"name": "Bodo", "native": "बड़ो", "tts": False, "speaker": None},
    "mai-IN": {"name": "Maithili", "native": "मैथिली", "tts": False, "speaker": None},
    "doi-IN": {"name": "Dogri", "native": "डोगरी", "tts": False, "speaker": None},
}

DEFAULT_LANGUAGE = "hi-IN"


def language_name(code: str) -> str:
    info = LANGUAGES.get(code)
    if not info:
        return "English"
    return f"{info['name']} ({info['native']})"
