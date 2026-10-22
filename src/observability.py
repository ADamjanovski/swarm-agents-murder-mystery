import base64
import json
import os
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any
from opentelemetry import trace
from opentelemetry.trace import Span
from strands.telemetry import StrandsTelemetry

DEFAULT_LANGFUSE_BASE_URL = "https://us.cloud.langfuse.com"

_telemetry: StrandsTelemetry | None = None


def _langfuse_otel_endpoint() -> str:
    """Return the OTLP endpoint for the configured Langfuse region."""
    base_url = os.getenv("LANGFUSE_BASE_URL", DEFAULT_LANGFUSE_BASE_URL).rstrip("/")
    if base_url.endswith("/api/public/otel"):
        return base_url
    return f"{base_url}/api/public/otel"


def setup_langfuse_tracing() -> StrandsTelemetry:
    """Configure Strands' native OpenTelemetry exporter for Langfuse.

    The configured instance is cached so rerunning a notebook cell does not add
    duplicate span processors and export every span multiple times.
    """
    global _telemetry

    if _telemetry is not None:
        return _telemetry

    public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
    secret_key = os.getenv("LANGFUSE_SECRET_KEY")
    if not public_key or not secret_key:
        raise RuntimeError(
            "Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY before enabling tracing."
        )

    credentials = base64.b64encode(
        f"{public_key}:{secret_key}".encode("utf-8")
    ).decode("ascii")

    os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = _langfuse_otel_endpoint()
    os.environ["OTEL_EXPORTER_OTLP_HEADERS"] = (
        f"Authorization=Basic {credentials},x-langfuse-ingestion-version=4"
    )
    os.environ.setdefault("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf")
    os.environ.setdefault("OTEL_SERVICE_NAME", "week-9-strands-agent")

    _telemetry = StrandsTelemetry().setup_otlp_exporter()
    return _telemetry


@contextmanager
def trace_agent_invocation(
    prompt: str,
    name: str = "week-9-multi-step-agent",
) -> Generator[Span, None, None]:
    """Create a named parent span around one Strands agent invocation."""
    tracer = trace.get_tracer(__name__)
    with tracer.start_as_current_span(name) as span:
        span.set_attribute("langfuse.trace.name", name)
        span.set_attribute("langfuse.session.id", "week-9-task-2")
        span.set_attribute(
            "langfuse.trace.tags",
            ["week-9", "strands", "openrouter", "multi-step"],
        )
        span.set_attribute("input.value", prompt)
        span.set_attribute("input.mime_type", "text/plain")
        yield span


def _compact(value: Any) -> str:
    """
    Serialize a value to a compact single-line JSON string.
    """
    return json.dumps(value, ensure_ascii=False, default=str)


def print_agent_trace(messages: list[dict[str, Any]]) -> list[str]:
    """Print emitted reasoning, tool inputs/outputs, and the final response."""
    print("\n\n=== Agent trajectory ===")
    tool_names: dict[str, str] = {}
    tools_used: list[str] = []
    step = 0

    for message in messages:
        role = message.get("role", "unknown")
        for block in message.get("content", []):
            reasoning = block.get("reasoningContent", {}).get("reasoningText", {})
            if reasoning.get("text"):
                step += 1
                print(f"{step}. {role} reasoning: {reasoning['text'].strip()}")

            if "toolUse" in block:
                tool_use = block["toolUse"]
                tool_name = tool_use["name"]
                tool_names[tool_use["toolUseId"]] = tool_name
                tools_used.append(tool_name)
                step += 1
                print(
                    f"{step}. assistant -> {tool_name} "
                    f"input={_compact(tool_use.get('input', {}))}"
                )

            if "toolResult" in block:
                tool_result = block["toolResult"]
                tool_name = tool_names.get(tool_result["toolUseId"], "unknown_tool")
                step += 1
                print(
                    f"{step}. {tool_name} -> assistant "
                    f"output={_compact(tool_result.get('content', []))}"
                )

            if block.get("text"):
                step += 1
                print(f"{step}. {role} text: {block['text'].strip()}")

    print(f"Tool order: {' -> '.join(tools_used) or 'no tools used'}")
    return tools_used
