import json
from pathlib import Path
from typing import Any


class GameRecorder:
    """Persist a replayable JSON event log + a human-readable transcript.

    - record.json : ordered list of typed events (for a future UI / replay)
    - meta.json   : summary (story, cast, result, culprit for debug)
    - transcript.txt : the game rendered as readable prose, written live
    - evaluation.json : deterministic metrics and post-game LLM judgment
    """

    def __init__(self, games_dir: Path, game_id: str | None = None) -> None:
        """
        Create a new game directory and initialize its empty record files.
        """
        games_dir.mkdir(parents=True, exist_ok=True)
        self.game_id = game_id or self._next_game_id(games_dir)
        self.directory = games_dir / self.game_id
        self.directory.mkdir(parents=False, exist_ok=False)
        self.record_path = self.directory / "record.json"
        self.meta_path = self.directory / "meta.json"
        self.transcript_path = self.directory / "transcript.txt"
        self.evaluation_path = self.directory / "evaluation.json"
        self.events: list[dict[str, Any]] = []
        self.transcript_path.write_text("", encoding="utf-8")
        self._write_json(self.record_path, self.events)

    @staticmethod
    def _next_game_id(games_dir: Path) -> str:
        """
        Return the next sequential game id based on existing game directories.
        """
        numbers = []
        for path in games_dir.glob("game_[0-9][0-9][0-9][0-9]"):
            try:
                numbers.append(int(path.name.removeprefix("game_")))
            except ValueError:
                continue
        return f"game_{max(numbers, default=0) + 1:04d}"

    @staticmethod
    def _write_json(path: Path, data: Any) -> None:
        """
        Atomically write data to a JSON file via a temporary file.
        """
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        temporary.replace(path)

    def write_meta(self, metadata: dict[str, Any]) -> None:
        """
        Write the game's metadata summary to meta.json.
        """
        self._write_json(self.meta_path, metadata)

    def update_meta(self, **updates: Any) -> None:
        """
        Merge the given fields into the existing metadata and rewrite meta.json.
        """
        metadata = json.loads(self.meta_path.read_text(encoding="utf-8"))
        metadata.update(updates)
        self.write_meta(metadata)

    def write_evaluation(self, evaluation: dict[str, Any]) -> None:
        """
        Write the post-game evaluation to evaluation.json.
        """
        self._write_json(self.evaluation_path, evaluation)

    def log(self, event_type: str, **data: Any) -> dict[str, Any]:
        """
        Append a typed event to the record and its rendered line to the transcript.
        """
        event = {"t": len(self.events), "type": event_type, **data}
        self.events.append(event)
        self._write_json(self.record_path, self.events)
        line = self._format_event(event_type, data)
        if line is not None:
            with self.transcript_path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
        return event

    def _format_event(self, event_type: str, data: dict[str, Any]) -> str | None:
        """
        Render an event as a human-readable transcript line, or None to skip it.
        """
        if event_type == "game_start":
            suspects = "\n".join(
                f"  {s['name']} — {s['personality']}" for s in data.get("suspects", [])
            )
            return (
                f"=== {data.get('title')} ===\n"
                f"game {self.game_id}\n"
                f"Victim: {data.get('victim')}\n\nSuspects:\n{suspects}"
            )
        if event_type == "ground_truth":
            return f"  culprit (debug, hidden from players): {data.get('culprit')}"
        if event_type == "phase":
            phase = data.get("phase")
            rnd = data.get("round")
            if phase == "opening":
                return "\n────────── OPENING STATEMENTS ──────────"
            if phase == "discuss":
                return f"\n────────── ROUND {rnd}: DISCUSSION ──────────"
            if phase == "accuse":
                return "\n────────── FINAL ACCUSATIONS ──────────"
            return None
        if event_type == "opening_statement":
            return f"  {data.get('actor')} (alibi): {data.get('text')}"
        if event_type == "tool_call":
            found = data.get("result_doc_ids") or []
            return (
                f"    · {data.get('actor')} → {data.get('tool')}("
                f"{data.get('args')}) ⇒ {', '.join(found) if found else data.get('summary','')}"
            )
        if event_type == "plant_evidence":
            return (
                f"    ⚠ {data.get('actor')} PLANTED evidence [{data.get('doc_id')}]: "
                f"\"{data.get('text')}\""
            )
        if event_type == "statement":
            return f"  {data.get('actor')}: {data.get('text')}"
        if event_type == "belief":
            notes = data.get("notes") or {}
            rendered = "; ".join(f"{k}={v}" for k, v in notes.items()) or "(none)"
            return f"    [beliefs {data.get('actor')}] {rendered}"
        if event_type == "accusation":
            cite = f" (cites {data.get('doc_id')})" if data.get("doc_id") else ""
            return f"  {data.get('actor')} accuses {data.get('target')} — \"{data.get('reason')}\"{cite}"
        if event_type == "resolution":
            return (
                f"\n  Tally: {data.get('tally')}\n"
                f"  Convicted: {data.get('convicted')}"
            )
        if event_type == "win":
            return (
                f"\n=== RESULT: {data.get('winner').upper()} WIN ===\n"
                f"Convicted: {data.get('convicted')}  |  True culprit: {data.get('culprit')}\n"
                f"Accusations grounded in cited evidence: {data.get('grounded_accusations')}"
                f"/{data.get('total_accusations')}"
            )
        return None
