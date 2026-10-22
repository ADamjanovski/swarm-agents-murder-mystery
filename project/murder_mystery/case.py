import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class Suspect:
    """One player character: a name, a communication personality, and a story bio."""

    name: str
    personality: str
    bio: str


@dataclass(frozen=True, slots=True)
class Case:
    """The public, player-visible facts of a case. No hidden ground truth here."""

    case_id: str
    title: str
    setting: str
    victim: dict[str, Any]
    suspects: tuple[Suspect, ...]
    evidence_files: tuple[str, ...]
    story_dir: Path

    @property
    def suspect_names(self) -> list[str]:
        """
        Return the list of suspect names in this case.
        """
        return [suspect.name for suspect in self.suspects]

    def get_suspect(self, name: str) -> Suspect:
        """
        Return the suspect with the given name, or raise KeyError if unknown.
        """
        for suspect in self.suspects:
            if suspect.name == name:
                return suspect
        raise KeyError(f"unknown suspect: {name}")

    def evidence_path(self, filename: str) -> Path:
        """
        Return the filesystem path to an evidence file for this case.
        """
        return self.story_dir / "evidence" / filename


@dataclass(frozen=True, slots=True)
class Solution:
    """Moderator only ground truth. Never gate this into any agent prompt/corpus."""

    culprit: str
    motive: str
    method: str
    whereabouts: dict[str, str]
    proof_chain: tuple[str, ...] = ()
    red_herrings: tuple[str, ...] = ()


def _require(mapping: dict[str, Any], key: str, where: str) -> Any:
    """
    Return a required key from a mapping, raising ValueError if it is missing.
    """
    if key not in mapping:
        raise ValueError(f"{where} is missing required field '{key}'")
    return mapping[key]


def load_case(story_dir: Path) -> Case:
    """Load and validate the public case manifest for a story folder."""
    case_path = story_dir / "case.json"
    if not case_path.exists():
        raise ValueError(f"no case.json in {story_dir}")
    raw = json.loads(case_path.read_text(encoding="utf-8"))

    raw_suspects = _require(raw, "suspects", "case.json")
    if not isinstance(raw_suspects, list) or len(raw_suspects) < 3:
        raise ValueError("case.json must list at least three suspects")

    suspects: list[Suspect] = []
    for index, entry in enumerate(raw_suspects):
        try:
            suspects.append(
                Suspect(
                    name=entry["name"],
                    personality=entry["personality"],
                    bio=entry["bio"],
                )
            )
        except (TypeError, KeyError) as exc:
            raise ValueError(
                f"suspect {index} needs 'name', 'personality', and 'bio'"
            ) from exc

    names = [suspect.name for suspect in suspects]
    if len(set(names)) != len(names):
        raise ValueError("suspect names must be unique")

    evidence_files = tuple(_require(raw, "evidence", "case.json"))
    missing = [f for f in evidence_files if not (story_dir / "evidence" / f).exists()]
    if missing:
        raise ValueError(f"evidence files not found: {missing}")

    return Case(
        case_id=raw.get("id", story_dir.name),
        title=_require(raw, "title", "case.json"),
        setting=_require(raw, "setting", "case.json"),
        victim=_require(raw, "victim", "case.json"),
        suspects=tuple(suspects),
        evidence_files=evidence_files,
        story_dir=story_dir,
    )


def load_solution(story_dir: Path, case: Case | None = None) -> Solution:
    """Load and validate the moderator-only ground truth for a story folder."""
    solution_path = story_dir / "solution.json"
    if not solution_path.exists():
        raise ValueError(f"no solution.json in {story_dir}")
    raw = json.loads(solution_path.read_text(encoding="utf-8"))

    culprit = _require(raw, "culprit", "solution.json")
    whereabouts = dict(_require(raw, "whereabouts", "solution.json"))

    if case is not None:
        if culprit not in case.suspect_names:
            raise ValueError(f"culprit {culprit!r} is not one of the suspects")
        missing = [name for name in case.suspect_names if name not in whereabouts]
        if missing:
            raise ValueError(f"solution.json lacks whereabouts for: {missing}")

    return Solution(
        culprit=culprit,
        motive=_require(raw, "motive", "solution.json"),
        method=raw.get("method", ""),
        whereabouts=whereabouts,
        proof_chain=tuple(raw.get("proof_chain", ())),
        red_herrings=tuple(raw.get("red_herrings", ())),
    )


def load_story(stories_dir: Path, story_id: str) -> tuple[Case, Solution]:
    """Load a story by id, returning its public Case and moderator-only Solution."""
    story_dir = stories_dir / story_id
    if not story_dir.is_dir():
        available = sorted(p.name for p in stories_dir.iterdir() if p.is_dir())
        raise ValueError(f"unknown story {story_id!r}; available: {available}")
    case = load_case(story_dir)
    solution = load_solution(story_dir, case)
    return case, solution
