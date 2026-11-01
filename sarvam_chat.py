"""Minimal Sarvam AI chat completion example."""

import os
import sys
from pathlib import Path

from sarvamai import SarvamAI


def load_env(path: Path) -> None:
    """Load KEY=VALUE pairs from .env into the environment (stdlib only)."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def main() -> None:
    load_env(Path(__file__).resolve().parent / ".env")

    api_key = os.environ.get("SARVAM_API_KEY")
    if not api_key:
        sys.exit("SARVAM_API_KEY is not set. Paste your key into the .env file.")

    client = SarvamAI(api_subscription_key=api_key)

    response = client.chat.completions(
        model="sarvam-105b-conversations",
        messages=[{"role": "user", "content": "Say hello in one short sentence."}],
    )

    print(response.choices[0].message.content)


if __name__ == "__main__":
    main()
