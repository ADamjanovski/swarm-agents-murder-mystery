import chromadb
from typing import Any
from chromadb.config import Settings
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction
from langchain_text_splitters import RecursiveCharacterTextSplitter
from .case import Case


def create_evidence_collection(case: Case, config):
    """
    Build an in-memory Chroma collection populated with the case's evidence files.
    """
    client = chromadb.EphemeralClient(Settings(anonymized_telemetry=False))
    embedding_function = SentenceTransformerEmbeddingFunction(
        model_name=config.embedding_model,
        normalize_embeddings=True,
    )
    embedding_function._model.max_seq_length = config.embedding_max_seq_length
    collection = client.get_or_create_collection(
        name="evidence",
        embedding_function=embedding_function,
        metadata={"hnsw:space": "cosine"},
    )
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=config.chunk_size,
        chunk_overlap=config.chunk_overlap,
    )
    for doc_id in case.evidence_files:
        add_documents(
            collection,
            splitter,
            case.evidence_path(doc_id).read_text(encoding="utf-8"),
            doc_id,
            doc_id.rsplit(".", 1)[-1].lower(),
        )
    return collection


def add_documents(
    collection,
    splitter: RecursiveCharacterTextSplitter,
    text: str,
    doc_id: str,
    doc_type: str,
    *,
    tampered: bool = False,
) -> None:
    """
    Split text into chunks and upsert them into the collection with metadata.
    """
    chunks = [chunk.strip() for chunk in splitter.split_text(text) if chunk.strip()]
    if not chunks:
        return

    collection.upsert(
        ids=[f"{doc_id}--{index}" for index in range(len(chunks))],
        documents=chunks,
        metadatas=[
            {
                "doc_id": doc_id,
                "doc_type": doc_type,
                "chunk_index": index,
                "tampered": tampered,
            }
            for index in range(len(chunks))
        ],
    )


def add_planted_evidence(collection, doc_id: str, text: str, config) -> None:
    """
    Add fabricated evidence to the collection, flagged as tampered.
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=config.chunk_size,
        chunk_overlap=config.chunk_overlap,
    )
    add_documents(
        collection,
        splitter,
        text,
        doc_id,
        "planted",
        tampered=True,
    )


def query_collection(collection, queries: list[str], n_results: int):
    """
    Run semantic queries against the collection and return the raw results.
    """
    return collection.query(
        query_texts=queries,
        n_results=n_results,
    )

INSTRUMENTED_HINTS = (
    "badge",
    "wifi",
    "cctv",
    "camera",
    "phone",
    "coroner",
    "photo",
    "printer",
    "log",
    "security",
)
INSTRUMENTED_TYPES = {"csv", "log"}


def search_evidence(collection, query: str, top_k: int) -> dict[str, Any]:
    """Top-k semantic hits, deduplicated by document: one (best) chunk per
    doc_id, so a search surfaces k distinct documents rather than the same
    document repeated through several of its chunks."""
    count = collection.count()
    if count == 0:
        return {"query": query, "results": []}

    raw = query_collection(collection, [query], min(top_k * 4, count))
    results = []
    seen_docs: set[str] = set()
    for text, metadata, distance in zip(
        raw["documents"][0], raw["metadatas"][0], raw["distances"][0], strict=True
    ):
        if metadata["doc_id"] in seen_docs:
            continue
        seen_docs.add(metadata["doc_id"])
        results.append(
            {
                "doc_id": metadata["doc_id"],
                "doc_type": metadata["doc_type"],
                "text": text,
                "score": round(1.0 - distance, 4),
            }
        )
        if len(results) >= top_k:
            break
    return {"query": query, "results": results}


def read_document(collection, doc_id: str) -> dict[str, Any]:
    """
    Return the full ordered chunks of a single document by its id.
    """
    raw = collection.get(
        where={"doc_id": doc_id},
        include=["documents", "metadatas"],
    )
    if not raw["ids"]:
        return {
            "doc_id": doc_id,
            "found": False,
            "error": f"no document '{doc_id}'; use list_evidence",
        }

    ordered = sorted(
        zip(raw["documents"], raw["metadatas"], strict=True),
        key=lambda item: item[1]["chunk_index"],
    )
    return {
        "doc_id": doc_id,
        "found": True,
        "chunks": [text for text, _ in ordered],
    }


def list_evidence(collection) -> dict[str, Any]:
    """
    List every distinct document in the collection with its type.
    """
    raw = collection.get(include=["metadatas"])
    documents: dict[str, str] = {}
    for metadata in raw["metadatas"]:
        documents.setdefault(metadata["doc_id"], metadata["doc_type"])
    return {
        "documents": [
            {"doc_id": doc_id, "doc_type": doc_type}
            for doc_id, doc_type in documents.items()
        ]
    }


def check_security_logs(
    collection,
    top_k: int,
    person: str | None = None,
    around_time: str | None = None,
) -> dict[str, Any]:
    """
    Search for instrumented security records, optionally filtered by person and time.
    """
    query = " ".join(
        part
        for part in [person, around_time, "badge wifi camera phone log time"]
        if part
    )
    hits = [
        hit
        for hit in search_evidence(collection, query, top_k * 2)["results"]
        if _is_instrumented(hit["doc_id"], hit["doc_type"])
    ]
    return {"person": person, "around_time": around_time, "results": hits[:top_k]}


def read_witness_statements(
    collection, top_k: int, about_person: str | None = None
) -> dict[str, Any]:
    """
    Search for witness statements, optionally filtered by the person they concern.
    """
    query = " ".join(
        part for part in [about_person, "witness statement saw"] if part
    )
    hits = [
        hit
        for hit in search_evidence(collection, query, top_k * 2)["results"]
        if any(
            key in hit["doc_id"].lower()
            for key in ("witness", "statement", "interview")
        )
    ]
    return {"about": about_person, "results": hits[:top_k]}


def check_alibi(collection, top_k: int, suspect: str) -> dict[str, Any]:
    """
    Search for evidence about a suspect's alibi and whereabouts.
    """
    query = f"{suspect} alibi whereabouts location time where was"
    return {
        "suspect": suspect,
        "results": search_evidence(collection, query, top_k)["results"],
    }


def cross_reference(collection, top_k: int, a: str, b: str) -> dict[str, Any]:
    """
    Search for evidence connecting two entities.
    """
    return {
        "a": a,
        "b": b,
        "results": search_evidence(collection, f"{a} {b}", top_k)["results"],
    }


def authenticate_evidence(collection, doc_id: str) -> dict[str, Any]:
    """
    Check whether a document shows signs of tampering and return a verdict.
    """
    raw = collection.get(where={"doc_id": doc_id}, include=["metadatas"])
    if not raw["ids"]:
        return {"doc_id": doc_id, "found": False}

    tampered = any(metadata["tampered"] for metadata in raw["metadatas"])
    return {
        "doc_id": doc_id,
        "found": True,
        "tampered": tampered,
        "verdict": (
            "shows signs of fabrication / no chain of custody"
            if tampered
            else "authentic — consistent with system records"
        ),
    }


def can_tamper(collection, doc_id: str) -> tuple[bool, str | None]:
    """
    Determine whether a document may be forged, rejecting instrumented records.
    """
    raw = collection.get(where={"doc_id": doc_id}, include=["metadatas"])
    if raw["ids"]:
        doc_type = raw["metadatas"][0]["doc_type"]
        if _is_instrumented(doc_id, doc_type):
            return False, f"'{doc_id}' is an instrumented record and cannot be forged"
    elif _is_instrumented(doc_id, doc_id.rsplit(".", 1)[-1].lower()):
        return False, f"'{doc_id}' looks like an instrumented record and cannot be forged"
    return True, None


def _is_instrumented(doc_id: str, doc_type: str) -> bool:
    """
    Report whether a document is a hard-to-forge instrumented record.
    """
    lower = doc_id.lower()
    return doc_type in INSTRUMENTED_TYPES or any(
        hint in lower for hint in INSTRUMENTED_HINTS
    )
