import os
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any

from langfuse import get_client, propagate_attributes


def langfuse_enabled() -> bool:
    """
    Report whether Langfuse tracing is enabled and configured with keys.
    """
    if os.getenv("MM_LANGFUSE_ENABLED", "true").lower() in {"0", "false", "no", "off"}:
        return False
    return bool(os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY"))


class Telemetry:
    """
    Wraps optional Langfuse tracing for a single game's agent spans.
    """

    def __init__(
        self, game_id: str, game_name: str, model: str, judge_model: str
    ) -> None:
        """
        Initialize telemetry, acquiring a Langfuse client only if tracing is enabled.
        """
        self.game_id = game_id
        self.game_name = game_name
        self.model = model
        self.judge_model = judge_model
        self.client = None
        if not langfuse_enabled():
            return
        try:
            self.client = get_client()
        except Exception:
            # Observability must never prevent a game from running.
            self.client = None

    @contextmanager
    def game_trace(self) -> Generator[None, None, None]:
        """
        Open a parent trace span covering an entire game, or pass through if disabled.
        """
        if self.client is None:
            yield
            return
        try:
            with propagate_attributes(
                session_id=f"{self.game_name} - {self.game_id}",
                trace_name="murder-mystery-game",
                tags=["murder-mystery", "multi-agent", "rag"],
                metadata={
                    "game_id": self.game_id,
                    "game_name": self.game_name,
                    "model": self.model,
                    "judge_model": self.judge_model,
                },
            ):
                with self.client.start_as_current_observation(
                    as_type="span", name="murder-mystery-game"
                ):
                    yield
        finally:
            self.client.flush()

    @contextmanager
    def span(self, name: str, **metadata: Any) -> Generator[None, None, None]:
        """Open a nested span so the Strands agent/tool spans created inside it
        group under `name` — a phase, a discussion round, or one suspect's turn —
        instead of landing flat under the game. This is what turns the trace from
        a single game-wide token total into a navigable per-phase/per-agent tree.

        A no-op (plain pass-through) when tracing is disabled, so callers can wrap
        unconditionally.
        """
        if self.client is None:
            yield
            return
        with self.client.start_as_current_observation(
            as_type="span", name=name, metadata=metadata or None
        ):
            yield
