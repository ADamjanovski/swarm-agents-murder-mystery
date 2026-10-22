# Week 9 — RAG, Agents, and a Multi-Agent Murder Mystery

This week has two parts:

- **Tasks 1 and 2** live in [`src/`](src/) (the library code) and
  [`notebooks/`](notebooks/) (the walkthrough that runs them).
- **The final project** lives in [`project/`](project/) — an autonomous
  multi-agent murder-mystery game.

## Structure

```
week_9/
├── notebooks/
│   └── week_9_rag_agents.ipynb   # Tasks 1 & 2 — run top to bottom from the repo root
├── src/                          # Task 1 & 2 library code (imported by the notebook)
│   ├── preprocess.py             #   Task 1: load + chunk web/PDF sources
│   ├── rag.py                    #   Task 1: Chroma collection, retrieval, grounded prompt
│   ├── agents.py                 #   Task 2: Strands tool-using agent (calculator + scores)
│   ├── observability.py          #   Task 2: Langfuse/OpenTelemetry tracing + trajectory print
│   ├── model_client.py           #   shared LiteLLM/OpenRouter client with retry/backoff
│   └── config.py                 #   sources, evaluation questions, retryable errors
├── project/                      # Final project
│   ├── murder_mystery/           #   the game package  →  python -m murder_mystery
│   ├── frontend/                 #   web viewer for recorded games
│   ├── Project_Brief.md          #   project spec
│   └── QA.md                     #   design Q&A / notes
├── screenshots/                  # agent + suspect screenshots
├── pyproject.toml                # dependencies (managed with uv)
├── uv.lock
└── README.md
```

## Setup

Dependencies are managed with [uv](https://docs.astral.sh/uv/):

```bash
uv sync
```

## Tasks 1 & 2 — `src/` + `notebooks/`

Open the notebook and run it from the repository root (it adds `src/` to the path
and imports from it):

```bash
uv run --env-file .env jupyter notebook notebooks/week_9_rag_agents.ipynb
```

- **Task 1 — Retrieval-Augmented Generation.** Chunk web pages and PDFs
  (`preprocess.py`) into a Chroma collection (`rag.py`), retrieve the most relevant
  chunks for a question, and compare an **ungrounded** answer against a
  **grounded** answer built from the retrieved context — showing how grounding and
  citations reduce confident hallucinations.

- **Task 2 — Multi-step tool agent with observability.** A Strands agent
  (`agents.py`) equipped with a `calculator` and a `get_student_scores` tool is run
  across different OpenRouter models. Each run is wrapped in a Langfuse/OpenTelemetry
  trace (`observability.py`) and its tool-call trajectory is printed for inspection.

## Final project — `project/`

An autonomous multi-agent **murder mystery**. LLM agents play the suspects,
investigate a retrievable evidence corpus with tools, and vote to accuse the
culprit — while the culprit lies and plants false evidence to escape. A
deterministic Python moderator runs the game and is the only writer of game state;
a post-game LLM judge scores the transcript against a fixed rubric; Langfuse traces
each phase and each suspect's turn.

Run a game from the `project/` directory:

```bash
cd project
uv run --env-file .env python -m murder_mystery --story story_2
```
