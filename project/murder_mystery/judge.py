import json
from typing import Any
from strands import Agent, ModelRetryStrategy

from . import prompts
from .helpers import extract_json
from .metrics import deterministic_metrics
from .model_client import create_model
from .rubric import RUBRIC_VERSION, Judgment
from .validation import validate_judgment


def build_judge_packet(case, solution, events: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Assemble the packet handed to the judge: ground truth, result, per-suspect
    dossiers, and the full evidence text.
    """
    dossiers: dict[str, dict[str, Any]] = {
        name: {
            "name": name,
            "role": "culprit" if name == solution.culprit else "innocent investigator",
            "opening": None,
            "rounds": {},
            "accusation": None,
        }
        for name in case.suspect_names
    }
    result: dict[str, Any] = {}
    current_round = 0
    current_phase = "setup"

    for event in events:
        event_type = event["type"]
        if event_type == "phase":
            current_phase = event.get("phase", current_phase)
            current_round = event.get("round", current_round)
            continue
        actor = event.get("actor")
        if event_type == "resolution":
            result["resolution"] = {
                "tally": event.get("tally", {}),
                "convicted": event.get("convicted"),
            }
            continue
        if event_type == "win":
            result["win"] = {
                "winner": event.get("winner"),
                "convicted": event.get("convicted"),
                "culprit": event.get("culprit"),
            }
            continue
        if actor not in dossiers:
            continue

        dossier = dossiers[actor]
        if event_type == "opening_statement":
            dossier["opening"] = {"t": event["t"], "round": 0, "text": event.get("text", "")}
            continue
        if event_type == "accusation":
            dossier["accusation"] = {
                "t": event["t"],
                "target": event.get("target"),
                "reason": event.get("reason", ""),
                "doc_id": event.get("doc_id"),
            }
            continue
        if current_phase != "discuss":
            continue

        round_data = dossier["rounds"].setdefault(
            str(current_round),
            {"round": current_round, "tool_calls": [], "belief": None, "statement": None},
        )
        if event_type == "tool_call":
            round_data["tool_calls"].append(
                {
                    "t": event["t"],
                    "tool": event.get("tool"),
                    "args": event.get("args", {}),
                    "result_doc_ids": event.get("result_doc_ids", []),
                    "counts_toward_budget": event.get("tool") != "list_evidence",
                }
            )
        elif event_type == "belief":
            round_data["belief"] = {"t": event["t"], "notes": event.get("notes", {})}
        elif event_type == "statement":
            round_data["statement"] = {"t": event["t"], "text": event.get("text", "")}
        elif event_type == "plant_evidence":
            round_data.setdefault("plants", []).append(
                {"t": event["t"], "doc_id": event.get("doc_id"), "text": event.get("text", "")}
            )

    agent_dossiers = []
    for name in case.suspect_names:
        dossier = dossiers[name]
        dossier["rounds"] = [
            dossier["rounds"][key]
            for key in sorted(dossier["rounds"], key=int)
        ]
        agent_dossiers.append(dossier)

    return {
        "ground_truth": {
            "culprit": solution.culprit,
            "motive": solution.motive,
            "method": solution.method,
            "proof_chain": list(solution.proof_chain),
            "red_herrings": list(solution.red_herrings),
        },
        "deterministic_result": result,
        "case": {
            "id": case.case_id,
            "title": case.title,
            "setting": case.setting,
            "victim": case.victim,
            "suspects": [
                {
                    "name": suspect.name,
                    "personality": suspect.personality,
                    "bio": suspect.bio,
                }
                for suspect in case.suspects
            ],
        },
        "evidence_documents": {
            doc_id: case.evidence_path(doc_id).read_text(encoding="utf-8")
            for doc_id in case.evidence_files
        },
        "agent_dossiers": agent_dossiers,
    }


def _judge_prompt(packet: dict[str, Any], suspect_names: list[str]) -> str:
    """
    Build the judge's user prompt from the packet and suspect names.
    """
    return prompts.judge(
        culprit=packet["ground_truth"]["culprit"],
        suspect_names=suspect_names,
        schema_json=json.dumps(Judgment.model_json_schema(), ensure_ascii=False),
        packet_json=json.dumps(packet, ensure_ascii=False),
    )


class GameJudge:
    """
    Runs the post-game LLM evaluation and writes the result.
    """

    def __init__(self, config, recorder, api_guard) -> None:
        """
        Store the config, recorder, and shared API guard.
        """
        self.config = config
        self.recorder = recorder
        self.api_guard = api_guard

    def evaluate(self, case, solution) -> dict[str, Any]:
        """
        Score a finished game with deterministic metrics plus a validated LLM
        judgment, then persist the evaluation.
        """
        deterministic = deterministic_metrics(self.recorder.events, solution.culprit)
        base = {
            "rubric_version": RUBRIC_VERSION,
            "game_id": self.recorder.game_id,
            "judge_model": self.config.judge_model,
            "deterministic": deterministic,
        }
        try:
            packet = build_judge_packet(case, solution, self.recorder.events)
            packet["deterministic_metrics"] = deterministic
            suspect_names = case.suspect_names
            agent = Agent(
                model=create_model(
                    self.config,
                    model_id=self.config.judge_model,
                    temperature=0.0,
                    max_tokens=self.config.judge_max_tokens,
                ),
                system_prompt=prompts.JUDGE_SYSTEM,
                callback_handler=None,
                retry_strategy=ModelRetryStrategy(max_attempts=1),
                trace_attributes={
                    "mm.game_id": self.recorder.game_id,
                    "mm.role": "judge",
                    "mm.rubric_version": RUBRIC_VERSION,
                },
            )
            prompt = _judge_prompt(packet, suspect_names)
            judgment = None
            correction = ""
            for attempt in range(self.config.judge_max_retries + 1):
                request = prompt if attempt == 0 else correction
                raw = str(self.api_guard.call(lambda r=request: agent(r))).strip()
                value = extract_json(raw)
                try:
                    if value is None:
                        raise ValueError("response was not valid JSON")
                    judgment = validate_judgment(
                        value,
                        suspect_names,
                        packet,
                        solution.culprit,
                    )
                    break
                except ValueError as exc:
                    correction = prompts.JUDGE_CORRECTION.format(error=exc)
            if judgment is None:
                raise ValueError("judge did not return a valid evaluation")
            evaluation = {**base, "status": "complete", "judgment": judgment}
        except Exception as exc:
            evaluation = {
                **base,
                "status": "error",
                "error": f"{type(exc).__name__}: {str(exc)[:500]}",
            }

        self.recorder.write_evaluation(evaluation)
        return evaluation
