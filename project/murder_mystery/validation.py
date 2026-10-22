from typing import Any
from pydantic import ValidationError
from .helpers import normalized
from .rubric import GAME_SCORES, Judgment


def _format_errors(exc: ValidationError) -> str:
    """Condense a Pydantic ValidationError into a short corrective message."""
    parts = []
    for error in exc.errors():
        location = ".".join(str(item) for item in error["loc"]) or "(root)"
        parts.append(f"{location}: {error['msg']}")
    return "; ".join(parts[:8])


def _source_texts(
    packet: dict[str, Any], actor: str, source: str, round_number: int | None
) -> list[str]:
    """
    Return the source text(s) a quote could have come from for one actor,
    source, and round.
    """
    dossier = next(
        (item for item in packet["agent_dossiers"] if item["name"] == actor), None
    )
    if dossier is None:
        return []
    if source == "opening" and round_number == 0 and dossier.get("opening"):
        return [dossier["opening"]["text"]]
    if source == "accusation" and round_number is None and dossier.get("accusation"):
        return [dossier["accusation"]["reason"]]
    if source == "statement" and isinstance(round_number, int):
        return [
            item["statement"]["text"]
            for item in dossier["rounds"]
            if item["round"] == round_number and item.get("statement")
        ]
    return []


def validate_judgment(
    value: dict[str, Any],
    suspect_names: list[str],
    packet: dict[str, Any],
    culprit: str,
) -> dict[str, Any]:
    """Parse the raw judge reply against the Judgment schema, then enforce the
    context-dependent rules Pydantic cannot know on its own: every actor is a
    real suspect, each suspect is scored exactly once, culprit_deception quotes
    the actual culprit, and every quote is a genuine substring of its source.

    Raises ValueError (with a corrective message) so evaluate() can reprompt.
    """
    try:
        judgment = Judgment.model_validate(value)
    except ValidationError as exc:
        raise ValueError(_format_errors(exc)) from exc

    valid_names = set(suspect_names)

    def _require_suspect(actor: str, where: str) -> None:
        """
        Raise if an actor name is not one of the real suspects.
        """
        if actor not in valid_names:
            raise ValueError(f"{where} names unknown suspect {actor!r}")

    for dimension_name in GAME_SCORES:
        dimension = getattr(judgment.scores, dimension_name)
        for example in dimension.examples:
            _require_suspect(example.actor, f"{dimension_name} example")
            if dimension_name == "culprit_deception" and example.actor != culprit:
                raise ValueError(
                    f"culprit_deception examples must quote actual culprit {culprit}"
                )
            if len(example.quote.split()) < 4:
                raise ValueError(f"example quote for {dimension_name} is too short")
            sources = _source_texts(packet, example.actor, example.source, example.round)
            normalized_quote = normalized(example.quote)
            if not sources or not any(
                normalized_quote in normalized(source_text) for source_text in sources
            ):
                raise ValueError(
                    f"quote for {dimension_name} is not in {example.actor}'s "
                    f"{example.source} source at round {example.round}"
                )

    returned_names = [entry.name for entry in judgment.agents]
    if len(returned_names) != len(suspect_names) or set(returned_names) != valid_names:
        raise ValueError("agents must contain every suspect exactly once")

    copying = judgment.copying_analysis
    for actor in (*copying.echoed_by, *copying.meaningful_challenges):
        _require_suspect(actor, "copying_analysis")
    if copying.originator not in {"", None, *suspect_names}:
        raise ValueError("copying_analysis.originator must be a suspect or empty")

    _require_suspect(
        judgment.best_independent_contribution.actor, "best_independent_contribution"
    )
    for item in judgment.misinterpreted_evidence:
        _require_suspect(item.actor, "misinterpreted_evidence")

    return judgment.model_dump()
