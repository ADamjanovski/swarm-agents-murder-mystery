import re, hashlib
from langchain_community.document_loaders import WebBaseLoader, PyMuPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from .config import URL_FILES, PDF_FILES

def create_chunks_from_url(splitter, url):
    """
    Load a web page and split it into chunks.
    """
    loader = WebBaseLoader(url)
    docs = loader.load()          
    return splitter.split_documents(docs)

def create_chunks_from_local_pdf(splitter, path):
    """
    Load a local PDF and split it into chunks.
    """
    docs = PyMuPDFLoader(path).load()
    return splitter.split_documents(docs)  

def slugify(text):
    """
    Turn text into a lowercase, hyphen-separated slug.
    """
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")

def unpack(chunks):
    """
    Flatten chunks into parallel lists of cleaned texts, stable ids, and scalar metadata.
    """
    texts, ids, metadatas = [], [], []
    for c in chunks:
        text = c.page_content
        text = clean(text)
        source = c.metadata.get("source", "unknown")
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:8]
        texts.append(text)
        ids.append(f"{slugify(source)}--{digest}")   
        metadatas.append({
            k: v for k, v in c.metadata.items()
            if isinstance(v, (str, int, float, bool))  
        })
    return texts, ids, metadatas

def clean(text):
    """
    Normalize whitespace and stray characters in chunk text.
    """
    text = text.replace("\xa0", " ")
    text = text.replace("\r\n", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

def build_chunks(chunk_size, chunk_overlap):
    """
    Load every configured URL and PDF, chunk them, and return deduplicated texts, ids, and metadata.
    """
    splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,      
        separators=["\n\n", "\n", ". ", " ", ""])
    
    chunks = []

    for url in URL_FILES:
        chunks+= create_chunks_from_url(splitter, url)
    
    for pdf in PDF_FILES:
        chunks+= create_chunks_from_local_pdf(splitter,pdf)

    texts, ids, metadatas = unpack(chunks)
    seen = set()
    dedup_ids, dedup_texts, dedup_metas = [], [], []

    for cid, text, meta in zip(ids, texts, metadatas):
        if text in seen:
            continue
        seen.add(text)
        dedup_ids.append(cid); dedup_texts.append(text); dedup_metas.append(meta)

    return dedup_texts, dedup_ids, dedup_metas