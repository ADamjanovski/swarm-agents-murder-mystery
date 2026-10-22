import chromadb
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

MINILM_MODEL_NAME = "all-MiniLM-L6-v2"
MINILM_MAX_SEQUENCE_LENGTH = 512


def create_minilm_embedding_function(
    max_seq_length: int = 500,
) -> SentenceTransformerEmbeddingFunction:
    """
        Return a Chroma MiniLM embedding function with a custom token limit.
    """

    embedding_function = SentenceTransformerEmbeddingFunction(
        model_name=MINILM_MODEL_NAME,
    )
    embedding_function._model.max_seq_length = max_seq_length
    return embedding_function

def create_client():
    """
    Create an in-memory Chroma client.
    """
    return chromadb.Client()


def create_collection(client, collection_name, embedding_function=None):
    """
    Get or create a Chroma collection, optionally with a custom embedding function.
    """
    kwargs = {"name": collection_name}
    if embedding_function is not None:
        kwargs["embedding_function"] = embedding_function
    return client.get_or_create_collection(**kwargs)

def add_documents(collection, documents, document_ids, metadatas=None):
    """
    Upsert documents with their ids and optional metadata into the collection.
    """
    collection.upsert(
        ids=document_ids,
        documents= documents,
        metadatas=metadatas
    )

def query_collection(collection,queries,n_results = 3):
    """
    Return the top-n semantic matches for the given queries.
    """
    return collection.query(
        query_texts= queries,
        n_results= n_results
    )


def build_grounded_prompt(question, chunks):
    """
    Build a context-grounded QA prompt that answers only from the chunks and cites their ids.
    """
    context = "\n\n".join(f"[{cid}]\n{text}" for cid, text in chunks)
    return (
        "Answer the question using ONLY the context below. "
        "If the context doesn't contain the answer, say so. "
        "Cite the chunk id(s) you used in square brackets.\n\n"
        f"CONTEXT:\n{context}\n\n"
        f"QUESTION: {question}"
    )
