from typing import Any
from .state import GameState

def get_public_state(state: GameState) -> dict[str, Any]:
    """Everything every suspect is allowed to see. No hidden ground truth."""
    case = state.case
    return {
        "round": state.round,
        "phase": state.phase.value,
        "case": {
            "title": case.title,
            "setting": case.setting,
            "victim": case.victim,
            "suspects": [
                {"name": s.name, "personality": s.personality, "bio": s.bio}
                for s in case.suspects
            ],
        },
        "evidence_index": list(case.evidence_files),
        "transcript": [dict(item) for item in state.transcript],
        "accusations": [dict(item) for item in state.accusations],
    }


def get_private_state(
    state: GameState, name: str, *, tool_calls_remaining: int
) -> dict[str, Any]:
    """Build an allow-listed private view for one suspect.

    Never leaks the solution, another suspect's guilt, or anyone else's
    whereabouts/notebook. The culprit sees their guilt brief; innocents see their
    own true whereabouts (a person knows where they were).
    """
    suspect_state = state.suspects.get(name)
    if suspect_state is None:
        raise KeyError(f"unknown suspect: {name}")

    private: dict[str, Any] = {
        "you_are": name,
        "belief_notes": dict(suspect_state.belief_notes),
        "your_findings": [dict(item) for item in suspect_state.notebook],
        "tool_calls_remaining_this_round": tool_calls_remaining,
    }
    if suspect_state.is_culprit:
        private["you_are_the_culprit"] = True
        private["guilt_brief"] = suspect_state.guilt_brief
    else:
        private["your_true_whereabouts"] = suspect_state.true_whereabouts
    return private


def get_agent_view(
    state: GameState, name: str, *, tool_calls_remaining: int
) -> dict[str, Any]:
    """
    Combine the public and private views into one agent-facing view for a suspect.
    """
    return {
        "public": get_public_state(state),
        "private": get_private_state(
            state,
            name,
            tool_calls_remaining=tool_calls_remaining,
        ),
    }
