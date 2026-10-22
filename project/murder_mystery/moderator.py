import random
from collections import Counter
from dataclasses import dataclass
from typing import Any

from .api import ApiCallGuard, ApiUnavailableError
from .case import load_story
from .gate import get_agent_view
from .judge import GameJudge
from .llm_agents import create_llm_agents
from .observability import Telemetry
from .rag import create_evidence_collection
from .record import GameRecorder
from .state import GameState, Phase, SuspectState


@dataclass(frozen=True, slots=True)
class GameResult:
    """
    The outcome of a finished game, returned to the caller.
    """

    game_id: str
    winner: str
    convicted: str | None
    culprit: str
    rounds: int
    record_path: str


class Moderator:
    """
    Deterministic referee: loads a case, runs the whodunit loop, and is the
    only writer of GameState. Agents reach evidence only through validated tools.
    """

    def __init__(
        self,
        config,
        story_id: str,
    ) -> None:
        """
        Load the case and wire up the evidence store, agents, recorder, and
        telemetry for one game.
        """
        self.config = config
        self.case, self.solution = load_story(config.stories_dir, story_id)
        self.evidence = create_evidence_collection(self.case, config)

        seed = getattr(config, "seed", None)
        self.seed = seed if seed is not None else random.randrange(2**32)
        self.rng = random.Random(self.seed)

        suspects: dict[str, SuspectState] = {}
        for suspect in self.case.suspects:
            is_culprit = suspect.name == self.solution.culprit
            suspects[suspect.name] = SuspectState(
                is_culprit=is_culprit,
                true_whereabouts=self.solution.whereabouts.get(suspect.name, ""),
                guilt_brief=self._guilt_brief() if is_culprit else None,
            )
        self.state = GameState(case=self.case, suspects=suspects)

        self.recorder = GameRecorder(config.games_dir)
        self.telemetry = Telemetry(
            self.recorder.game_id,
            self.case.title,
            config.model,
            config.judge_model,
        )
        self.api_guard = ApiCallGuard(
            min_interval_seconds=config.llm_min_interval_seconds,
            backoff_base_seconds=config.api_backoff_base_seconds,
            max_delay_seconds=config.api_max_delay_seconds,
            max_total_wait_seconds=config.api_max_total_wait_seconds,
            on_wait=lambda seconds, attempt, error: self.recorder.log(
                "api_wait",
                wait_seconds=seconds,
                consecutive_failure=attempt,
                error=error,
            ),
        )
        self.agents = create_llm_agents(
            self.state,
            self.config,
            self.evidence,
            self.recorder,
            self._record_llm_tool_result,
            self._reserve_tool_call,
            self.api_guard,
        )
        self._write_start_record()

    def _guilt_brief(self) -> str:
        """
        Build the secret briefing given only to the culprit.
        """
        s = self.solution
        return (
            f"You are the murderer. Motive: {s.motive} Method: {s.method} "
            f"Your true movements: {s.whereabouts.get(s.culprit, '')} "
            "Investigators do not know this. Lie convincingly and stay consistent."
        )

    def _write_start_record(self) -> None:
        """
        Write the opening meta record and log the game-start and ground-truth events.
        """
        cast = [
            {
                "name": suspect.name,
                "personality": suspect.personality,
                "is_culprit": self.state.suspects[suspect.name].is_culprit,
            }
            for suspect in self.case.suspects
        ]
        self.recorder.write_meta(
            {
                "game_id": self.recorder.game_id,
                "story_id": self.case.case_id,
                "title": self.case.title,
                "seed": self.seed,
                "culprit": self.solution.culprit,
                "suspects": cast,
                "result": None,
            }
        )
        self.recorder.log(
            "game_start",
            title=self.case.title,
            victim=self.case.victim,
            suspects=[{"name": s.name, "personality": s.personality} for s in self.case.suspects],
        )
        self.recorder.log("ground_truth", culprit=self.solution.culprit, private=True)

    def _view(self, name: str) -> dict[str, Any]:
        """
        Build one suspect's allow-listed view of the game for this turn.
        """
        suspect = self.state.suspects[name]
        return get_agent_view(
            self.state,
            name,
            tool_calls_remaining=max(
                0, self.config.tool_calls_per_round - suspect.tool_calls_this_round
            ),
        )

    def _set_phase(self, phase: Phase) -> None:
        """
        Advance the game to a new phase and record the transition.
        """
        self.state.phase = phase
        self.recorder.log("phase", phase=phase.value, round=self.state.round)

    def _speaking_order(self) -> list[str]:
        """
        Return a freshly shuffled speaking order each phase so no suspect
        permanently anchors the narrative (the culprit speaking first framed
        whole games).
        """
        names = list(self.agents)
        self.rng.shuffle(names)
        return names

    def _reserve_tool_call(self, actor: str) -> bool:
        """
        Claim one investigation tool call for a suspect this round, refusing
        once their budget is spent.
        """
        suspect = self.state.suspects[actor]
        if suspect.tool_calls_this_round >= self.config.tool_calls_per_round:
            return False
        suspect.tool_calls_this_round += 1
        return True

    @staticmethod
    def _doc_ids(result: dict[str, Any]) -> list[str]:
        """
        Pull the document ids out of a tool result, whatever its shape.
        """
        if "results" in result:
            return [hit.get("doc_id") for hit in result["results"] if hit.get("doc_id")]
        if "documents" in result:
            return [doc.get("doc_id") for doc in result["documents"]]
        if result.get("doc_id"):
            return [result["doc_id"]]
        return []

    def _record_llm_tool_result(
        self,
        actor: str,
        tool: str,
        args: dict[str, Any],
        result: dict[str, Any],
    ) -> None:
        """
        Persist one tool result in the caller's private notebook and log it.
        """
        suspect = self.state.suspects[actor]
        trimmed = dict(result)
        if "results" in trimmed:
            trimmed["results"] = [
                {
                    "doc_id": hit.get("doc_id"),
                    "text": (hit.get("text") or "")[:240],
                }
                for hit in trimmed["results"]
            ]
        if isinstance(trimmed.get("text"), str):
            trimmed["text"] = trimmed["text"][:1800]
        if "chunks" in trimmed:
            trimmed["chunks"] = [text[:600] for text in trimmed["chunks"]]
        suspect.notebook.append(
            {
                "round": self.state.round,
                "tool": tool,
                "args": dict(args),
                **trimmed,
            }
        )
        self.recorder.log(
            "tool_call",
            actor=actor,
            tool=tool,
            args=dict(args),
            result_doc_ids=self._doc_ids(result),
            private=True,
        )

    def _actor_span(self, actor: str, activity: str):
        """
        Open a trace span for one suspect's turn so their model and tool spans
        (and their token/cost totals) roll up per suspect per phase.
        """
        return self.telemetry.span(
            f"{actor} · {activity}",
            actor=actor,
            round=self.state.round,
            role="culprit" if self.state.suspects[actor].is_culprit else "investigator",
        )

    def _opening(self) -> None:
        """
        Run the opening phase where every suspect gives an alibi statement.
        """
        self._set_phase(Phase.OPENING)
        with self.telemetry.span("opening"):
            for name in self._speaking_order():
                with self._actor_span(name, "opening"):
                    text = self.agents[name].opening_statement(self._view(name))
                entry = {"round": 0, "actor": name, "text": text, "kind": "alibi"}
                self.state.transcript.append(entry)
                self.recorder.log("opening_statement", **entry)
        for agent in self.agents.values():
            agent.enable_tools()

    def _discuss(self) -> None:
        """
        Run one sealed discussion round: each statement is produced against the
        transcript as it stood befori this round, then all are published at once
        so later speakers cannot see and parrot earlier ones, which kills the
        intra-round information cascade.
        """
        self._set_phase(Phase.DISCUSS)
        entries: list[dict[str, Any]] = []
        with self.telemetry.span(
            f"round {self.state.round}: discussion", round=self.state.round
        ):
            for name in self._speaking_order():
                agent = self.agents[name]
                with self._actor_span(name, f"discussion r{self.state.round}"):
                    text = agent.discuss(self._view(name))
                    notes = agent.update_beliefs(self._view(name))
                entries.append({"round": self.state.round, "actor": name, "text": text})
                self.state.suspects[name].belief_notes = dict(notes)
                self.recorder.log("belief", actor=name, notes=dict(notes), private=True)
        for entry in entries:
            self.state.transcript.append(entry)
            self.recorder.log("statement", **entry)

    def _accuse(self) -> str | None:
        """
        Run the final accusation phase and return the convicted suspect, if any.
        """
        self._set_phase(Phase.ACCUSE)
        with self.telemetry.span("accusation"):
            for name in self._speaking_order():
                with self._actor_span(name, "accusation"):
                    accusation = self.agents[name].accuse(self._view(name))
                target = accusation.get("target")
                if target not in self.state.suspects or target == name:
                    target = None  # fallback: abstain on invalid/self accusation
                entry = {
                    "actor": name,
                    "target": target,
                    "reason": accusation.get("reason", ""),
                    "doc_id": accusation.get("doc_id"),
                }
                self.state.accusations.append(entry)
                self.recorder.log("accusation", **entry)

        tally = Counter(a["target"] for a in self.state.accusations if a["target"])
        convicted = None
        if tally:
            top = max(tally.values())
            leaders = [t for t, c in tally.items() if c == top]
            if len(leaders) == 1:
                convicted = leaders[0]
        self.recorder.log("resolution", tally=dict(tally), convicted=convicted)
        return convicted

    def run(self) -> GameResult:
        """
        Play a full game end-to-end, judging it afterward unless the API was
        unavailable.
        """
        with self.telemetry.game_trace():
            result = self._run()
            if result.winner != "unresolved_api":
                with self.telemetry.span("judge"):
                    evaluation = GameJudge(
                        self.config,
                        self.recorder,
                        self.api_guard,
                    ).evaluate(self.case, self.solution)
                self.recorder.update_meta(
                    evaluation={
                        "status": evaluation["status"],
                        "path": str(self.recorder.evaluation_path),
                    }
                )
            return result

    def _run(self) -> GameResult:
        """
        Run the game, turning an API outage into an unresolved result instead of
        a crash.
        """
        try:
            return self._run_game()
        except ApiUnavailableError as exc:
            self.state.winner = "unresolved_api"
            self.state.phase = Phase.COMPLETE
            self.recorder.log(
                "api_unavailable", message=str(exc), round=self.state.round
            )
            self.recorder.update_meta(
                result={
                    "winner": "unresolved_api",
                    "convicted": None,
                    "culprit": self.solution.culprit,
                    "rounds": self.state.round,
                }
            )
            return GameResult(
                game_id=self.recorder.game_id,
                winner="unresolved_api",
                convicted=None,
                culprit=self.solution.culprit,
                rounds=self.state.round,
                record_path=str(self.recorder.record_path),
            )

    def _run_game(self) -> GameResult:
        """
        Drive the game loop: opening, the discussion rounds, then accusation and
        resolution.
        """
        self._opening()
        for round_number in range(1, self.config.max_rounds + 1):
            self.state.round = round_number
            for suspect in self.state.suspects.values():
                suspect.tool_calls_this_round = 0
            self._discuss()

        convicted = self._accuse()
        winner = "investigators" if convicted == self.solution.culprit else "culprit"
        self.state.convicted = convicted
        self.state.winner = winner
        self.state.phase = Phase.COMPLETE

        grounded = sum(1 for a in self.state.accusations if a["target"] and a["doc_id"])
        total = sum(1 for a in self.state.accusations if a["target"])
        self.recorder.log(
            "win", winner=winner, convicted=convicted, culprit=self.solution.culprit,
            grounded_accusations=grounded, total_accusations=total,
        )
        self.recorder.update_meta(
            result={
                "winner": winner,
                "convicted": convicted,
                "culprit": self.solution.culprit,
                "grounded_accusations": grounded,
                "total_accusations": total,
                "rounds": self.config.max_rounds,
            }
        )
        return GameResult(
            game_id=self.recorder.game_id,
            winner=winner,
            convicted=convicted,
            culprit=self.solution.culprit,
            rounds=self.config.max_rounds,
            record_path=str(self.recorder.record_path),
        )
