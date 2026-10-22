from typing import Literal
from pydantic import BaseModel, Field

RUBRIC_VERSION = "2.0"

class ScoreExample(BaseModel):
    """One exact-quote citation backing a dimension score."""

    actor: str
    source: Literal["opening", "statement", "accusation"]
    round: int | None = Field(
        default=None,
        description="0 for opening, the discussion round integer, or null for accusation",
    )
    quote: str = Field(description="exact 8-30 word substring of the cited source")


class DimensionScore(BaseModel):
    """
    One rubric dimension's 1–5 score with rationale and quote examples.
    """

    score: int = Field(ge=1, le=5)
    rationale: str = Field(min_length=1)
    examples: list[ScoreExample] = Field(min_length=1, max_length=2)


class GameScores(BaseModel):
    """
    The six game-level rubric dimension scores.
    """

    reasoning_independence: DimensionScore
    evidence_grounding: DimensionScore
    investigative_progress: DimensionScore
    hypothesis_testing: DimensionScore
    final_accusation_quality: DimensionScore
    culprit_deception: DimensionScore


class AgentScore(BaseModel):
    """
    One suspect's per-agent scores and summary.
    """

    name: str
    independent_contribution: int = Field(ge=1, le=5)
    grounding_quality: int = Field(ge=1, le=5)
    reasoning_value: int = Field(ge=1, le=5)
    role_effectiveness: int = Field(ge=1, le=5)
    summary: str = Field(min_length=1)


class CopyingAnalysis(BaseModel):
    """
    Whether suspects reasoned independently or echoed a dominant claim.
    """

    dominant_claim: str
    originator: str | None = Field(default="", description="suspect name or empty string")
    echoed_by: list[str] = Field(default_factory=list)
    meaningful_challenges: list[str] = Field(default_factory=list)
    assessment: str


class BestContribution(BaseModel):
    """
    The single most valuable independent contribution in the game.
    """

    actor: str
    round: int
    contribution: str


class MisinterpretedEvidence(BaseModel):
    """
    One instance of a suspect misreading a piece of evidence.
    """

    actor: str
    round: int
    claim: str
    problem: str


class Judgment(BaseModel):
    """The full evaluation the judge model must return. This schema is both sent
    to the model (as its output contract) and used to parse/validate the reply,
    so the contract has a single source of truth."""

    scores: GameScores
    agents: list[AgentScore]
    copying_analysis: CopyingAnalysis
    best_independent_contribution: BestContribution
    missed_evidence: list[str]
    misinterpreted_evidence: list[MisinterpretedEvidence]
    strengths: list[str]
    failures: list[str]
    recommendations: list[str]


GAME_SCORES = tuple(GameScores.model_fields)
AGENT_SCORES = tuple(
    name for name in AgentScore.model_fields if name not in {"name", "summary"}
)
