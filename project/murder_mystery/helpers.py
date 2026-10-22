import json
import re
from typing import Any


def extract_json(text: str) -> dict[str, Any] | None:
    """Pull the first JSON object out of a free-text model reply (tolerates code fences)."""
    text = re.sub(r"```[a-zA-Z]*", "", text).replace("```", "").strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        return None
    try:
        value = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def trim_statement(text: str, limit: int) -> str:
    """Hard cap on a public statement, cutting at the last sentence boundary."""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = cut.rfind(".")
    return cut[: end + 1] if end > 0 else cut


def normalized(text: str) -> str:
    """Collapse runs of whitespace and casefold, for tolerant substring matching."""
    return " ".join(text.split()).casefold()
