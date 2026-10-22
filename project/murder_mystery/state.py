from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any
from .case import Case


class Phase(StrEnum):
    """
    Class that lets us know in which phase of the game we are.
    """
    SETUP = "setup"
    OPENING = "opening"
    DISCUSS = "discuss"
    ACCUSE = "accuse"
    COMPLETE = "complete"


@dataclass(slots=True)
class SuspectState:
    """
    Per-suspect mutable game state, including hidden guilt and private notes.
    """
    is_culprit: bool
    true_whereabouts: str            
    guilt_brief: str | None = None   
    belief_notes: dict[str, str] = field(default_factory=dict)
    notebook: list[dict[str, Any]] = field(default_factory=list)  
    tool_calls_this_round: int = 0


@dataclass(slots=True)
class GameState:
    """
    The full mutable state of a running game: case, suspects, and progress.
    """
    case: Case
    suspects: dict[str, SuspectState]
    round: int = 0
    phase: Phase = Phase.SETUP
    transcript: list[dict[str, Any]] = field(default_factory=list) 
    accusations: list[dict[str, Any]] = field(default_factory=list)
    convicted: str | None = None
    winner: str | None = None

    def suspect_names(self) -> list[str]:
        """
        Return the list of suspect names in the game.
        """
        return list(self.suspects)

    @property
    def game_over(self) -> bool:
        """
        Report whether the game has ended by having a winner.
        """
        return self.winner is not None
