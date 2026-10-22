import json
from collections.abc import Callable
from typing import Any
from strands import Agent, ModelRetryStrategy
from . import prompts
from .api import ApiCallGuard, ApiUnavailableError
from .helpers import extract_json, trim_statement
from .model_client import create_model
from .tools import ToolCallReservation, ToolResultCallback, build_tools


class LLMSuspectAgent:
    """Adapts a Strands Agent to the phase methods the moderator calls."""

    def __init__(
        self, name: str, agent: Any, tools: list[Any], api_guard: ApiCallGuard,
        max_retries: int = 2, seen: set | None = None,
        statement_max_chars: int = 900,
    ) -> None:
        """
        Wrap a Strands Agent with the per-suspect state the phase methods need.
        """
        self.name = name
        self.agent = agent
        self.tools = tools
        self.api_guard = api_guard
        self.max_retries = max_retries
        self.statement_max_chars = statement_max_chars
        self._seen = seen if seen is not None else set()
        self._tools_enabled = False
        self._transcript_cursor = 0


    def _consume_unseen_statements(self, view: dict) -> list[dict[str, Any]]:
        """
        Return public statements added since this agent's last turn, excluding
        its own, and advance the read cursor.
        """
        transcript = view["public"]["transcript"]
        unseen = transcript[self._transcript_cursor :]
        self._transcript_cursor = len(transcript)
        return [dict(item) for item in unseen if item.get("actor") != self.name]

    def enable_tools(self) -> None:
        """
        Register this suspect's investigation tools on the agent, once.
        """
        if self._tools_enabled:
            return
        for tool in self.tools:
            self.agent.tool_registry.register_tool(tool)
        self._tools_enabled = True

    def _ask(self, prompt: str, fallback: str) -> str:
        """
        Send one prompt through the API guard, returning the fallback text if
        the agent errors (but re-raising when the provider is unavailable).
        """
        try:
            return str(self.api_guard.call(lambda: self.agent(prompt))).strip()
        except ApiUnavailableError:
            raise
        except Exception as exc:  # one agent stumbling must not crash the game
            return f"{fallback} ({type(exc).__name__})"

    def _ask_json(self, prompt: str, validate: Callable[[dict], dict]) -> tuple[dict | None, str]:
        """Ask for a JSON reply; reprompt with the specific error until valid.

        Returns (validated_dict, last_raw_reply). Returns (None, raw) if the model
        never produces a valid structure within the retry budget — the caller then
        applies a safe fallback. This replaces provider-strict structured output,
        which OpenRouter/OpenAI reject at the schema level.
        """
        correction = ""
        raw = ""
        for _ in range(self.max_retries + 1):
            raw = self._ask(prompt + correction, "")
            obj = extract_json(raw)
            if obj is not None:
                try:
                    return validate(obj), raw
                except Exception as exc:
                    correction = (
                        f"\n\nYour previous reply was invalid: {exc}. "
                        "Reply with ONLY the JSON object described, nothing else."
                    )
                    continue
            correction = (
                "\n\nYour previous reply was not valid JSON. "
                "Reply with ONLY the JSON object described, nothing else."
            )
        return None, raw

    def opening_statement(self, view: dict) -> str:
        """
        Produce this suspect's opening alibi statement.
        """
        return self._ask(prompts.OPENING_STATEMENT, "I have no statement.")

    def discuss(self, view: dict) -> str:
        """
        Run this suspect's discussion turn (investigate, then one public
        contribution) and return the trimmed statement.
        """
        context = json.dumps(
            {
                "new_public_statements": self._consume_unseen_statements(view),
                "your_saved_findings": view["private"].get("your_findings", []),
                "your_previous_beliefs": view["private"].get("belief_notes", {}),
                "all_evidence_documents": view["public"]["evidence_index"],
            },
            ensure_ascii=False,
        )
        text = self._ask(
            prompts.discuss(
                round_number=view["public"]["round"],
                context=context,
                tool_calls_remaining=view["private"]["tool_calls_remaining_this_round"],
                is_culprit=bool(view["private"].get("you_are_the_culprit")),
            ),
            "I have nothing to add this round.",
        )
        return trim_statement(text, self.statement_max_chars)

    def update_beliefs(self, view: dict) -> dict:
        """
        Ask the suspect to update their private per-suspect belief notes.
        """
        others = [s["name"] for s in view["public"]["case"]["suspects"] if s["name"] != self.name]
        example = others[0] if others else "Name"

        def validate(obj: dict) -> dict:
            """
            Coerce the belief-notes reply to a string-to-string mapping.
            """
            return {str(k): str(v) for k, v in obj.items()}

        result, _ = self._ask_json(prompts.update_beliefs(example), validate)
        return result or {}

    def accuse(self, view: dict) -> dict:
        """
        Produce this suspect's sealed final accusation as a validated dict.
        """
        names = [s["name"] for s in view["public"]["case"]["suspects"]]
        evidence_ids = view["public"]["evidence_index"]
        prompt = prompts.accuse(
            new_statements_json=json.dumps(
                self._consume_unseen_statements(view), ensure_ascii=False
            ),
            findings_json=json.dumps(
                view["private"].get("your_findings", []), ensure_ascii=False
            ),
            valid_names=names,
            evidence_ids=evidence_ids,
            is_culprit=bool(view["private"].get("you_are_the_culprit")),
        )

        def validate(obj: dict) -> dict:
            """
            Normalize the accusation reply, keeping only a real cited doc_id.
            """
            if "target" not in obj:
                raise ValueError("missing key 'target'")
            doc = obj.get("doc_id") if obj.get("doc_id") in evidence_ids else None
            return {"target": obj.get("target"), "reason": str(obj.get("reason", "")), "doc_id": doc}

        result, raw = self._ask_json(prompt, validate)
        return result or {"target": None, "reason": raw[:400], "doc_id": None}


def create_llm_agents(
    state,
    config,
    collection,
    recorder,
    on_tool_result: ToolResultCallback,
    reserve_tool_call: ToolCallReservation,
    api_guard: ApiCallGuard,
) -> dict[str, LLMSuspectAgent]:
    """
    Build one LLMSuspectAgent per suspect, sharing the model and API guard.
    """
    model = create_model(config)
    agents: dict[str, LLMSuspectAgent] = {}
    for name, suspect_state in state.suspects.items():
        character = state.case.get_suspect(name)
        seen: set = set()  # whole-game tool-call dedup, shared by this agent's tools
        tools = build_tools(
            collection,
            tuple(state.case.evidence_files),
            config,
            recorder,
            name,
            suspect_state.is_culprit,
            on_tool_result,
            reserve_tool_call,
            seen,
        )
        agent = Agent(
            model=model,
            system_prompt=prompts.system_prompt(character, suspect_state, state.case),
            callback_handler=None,
            retry_strategy=ModelRetryStrategy(max_attempts=1),
            trace_attributes={
                "mm.game_id": recorder.game_id,
                "mm.suspect": name,
                "mm.role": "culprit" if suspect_state.is_culprit else "investigator",
                "mm.personality": character.personality,
            },
        )
        agents[name] = LLMSuspectAgent(
            name, agent, tools, api_guard, max_retries=config.max_retries, seen=seen,
            statement_max_chars=config.statement_max_chars,
        )
    return agents
