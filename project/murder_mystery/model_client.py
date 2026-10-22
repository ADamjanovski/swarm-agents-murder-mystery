import os

from strands.models.openai import OpenAIModel


OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


def create_model(
    config,
    *,
    model_id: str | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> OpenAIModel:
    """Build an OpenRouter-backed model. Sampling defaults to the values
    in config (config.temperature / config.max_tokens); the judge overrides both
    with explicit arguments."""
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY is required to run LLM suspects")

    return OpenAIModel(
        client_args={
            "api_key": api_key,
            "base_url": OPENROUTER_BASE_URL,
            "max_retries": 0,
        },
        model_id=model_id or config.model,
        params={
            "temperature": config.temperature if temperature is None else temperature,
            "max_tokens": config.max_tokens if max_tokens is None else max_tokens,
            "parallel_tool_calls": config.parallel_tool_calls,
        },
    )
