import json
from collections import Counter
from typing import Any


def deterministic_metrics(events: list[dict[str, Any]], culprit: str) -> dict[str, Any]:
    """
    Compute the objective, non-LLM metrics for a finished game from its event log.
    """
    statements = [event for event in events if event["type"] == "statement"]
    tool_calls = [event for event in events if event["type"] == "tool_call"]
    orientation_calls = [event for event in tool_calls if event["tool"] == "list_evidence"]
    budgeted_calls = [event for event in tool_calls if event["tool"] != "list_evidence"]
    accusations = [event for event in events if event["type"] == "accusation"]
    plants = [event for event in events if event["type"] == "plant_evidence"]

    votes = [event["target"] for event in accusations if event.get("target")]
    vote_counts = Counter(votes)
    tool_counts = Counter(event["tool"] for event in tool_calls)
    actor_tool_counts = Counter(event["actor"] for event in tool_calls)
    budgeted_tool_counts = Counter(event["tool"] for event in budgeted_calls)
    actor_budgeted_counts = Counter(event["actor"] for event in budgeted_calls)
    unique_queries = {
        (
            event["actor"],
            event["tool"],
            json.dumps(event.get("args", {}), sort_keys=True, ensure_ascii=False),
        )
        for event in tool_calls
    }
    retrieved_by_actor: dict[str, set[str]] = {}
    for event in budgeted_calls:
        retrieved_by_actor.setdefault(event["actor"], set()).update(
            event.get("result_doc_ids", [])
        )
    accepted_accusations = [event for event in accusations if event.get("target")]
    cited = sum(bool(event.get("doc_id")) for event in accepted_accusations)
    personally_retrieved_citations = sum(
        bool(event.get("doc_id"))
        and event["doc_id"] in retrieved_by_actor.get(event["actor"], set())
        for event in accepted_accusations
    )
    convicted = next(
        (event.get("convicted") for event in reversed(events) if event["type"] == "resolution"),
        None,
    )
    personally_retrieved_citation_rate = (
        round(personally_retrieved_citations / len(accepted_accusations), 4)
        if accepted_accusations
        else 0.0
    )

    return {
        "culprit_convicted": convicted == culprit,
        "convicted": convicted,
        "vote_counts": dict(vote_counts),
        "largest_vote_share": (
            round(max(vote_counts.values()) / len(votes), 4) if votes else 0.0
        ),
        "citation_presence_rate": (
            round(cited / len(accepted_accusations), 4) if accepted_accusations else 0.0
        ),
        "personally_retrieved_citation_rate": personally_retrieved_citation_rate,
        "valid_citation_rate": personally_retrieved_citation_rate,
        "tool_calls": len(tool_calls),
        "orientation_tool_calls": len(orientation_calls),
        "budgeted_tool_calls": len(budgeted_calls),
        "unique_tool_queries": len(unique_queries),
        "tool_calls_by_name": dict(tool_counts),
        "tool_calls_by_actor": dict(actor_tool_counts),
        "budgeted_tool_calls_by_name": dict(budgeted_tool_counts),
        "budgeted_tool_calls_by_actor": dict(actor_budgeted_counts),
        "plant_count": len(plants),
        "statement_count": len(statements),
        "average_statement_characters": (
            round(sum(len(event.get("text", "")) for event in statements) / len(statements))
            if statements
            else 0
        ),
        "average_statement_words": (
            round(
                sum(len(event.get("text", "").split()) for event in statements)
                / len(statements)
            )
            if statements
            else 0
        ),
    }
