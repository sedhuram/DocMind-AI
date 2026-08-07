import datetime
from dataclasses import dataclass

import chromadb

_PAGE_NUMBER_NONE_SENTINEL = -1
_COLLECTION_NAME = "docmind_chunks"


@dataclass
class RetrievedChunk:
    document_id: str
    filename: str
    chunk_index: int
    page_number: int | None
    text: str
    score: float
    source_name: str | None = None
    chunk_id: str | None = None
    upload_timestamp: str | None = None


class VectorStore:
    def __init__(self, persist_dir: str):
        self._client = chromadb.PersistentClient(path=persist_dir)
        self._collection = self._client.get_or_create_collection(
            name=_COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )

    def add_chunks(
        self,
        document_id: str,
        filename: str,
        source_type: str,
        chunks: list[str],
        embeddings: list[list[float]],
        page_numbers: list[int | None],
    ) -> None:
        if not chunks:
            return
        ids = [f"{document_id}_{i}" for i in range(len(chunks))]
        upload_time = datetime.datetime.now(datetime.timezone.utc).isoformat()
        metadatas = [
            {
                "document_id": document_id,
                "filename": filename,
                "source_type": source_type,
                "chunk_index": i,
                "page_number": page_numbers[i] if page_numbers[i] is not None else _PAGE_NUMBER_NONE_SENTINEL,
                "source_name": filename,
                "chunk_id": f"{document_id}_{i}",
                "upload_timestamp": upload_time,
            }
            for i in range(len(chunks))
        ]
        self._collection.add(ids=ids, embeddings=embeddings, documents=chunks, metadatas=metadatas)

    def query(self, query_embedding: list[float], top_k: int) -> list[RetrievedChunk]:
        if self.count() == 0:
            return []
        result = self._collection.query(
            query_embeddings=[query_embedding],
            n_results=min(top_k, self.count()),
            include=["documents", "metadatas", "distances"],
        )
        return [
            self._to_chunk(doc, meta, distance)
            for doc, meta, distance in zip(result["documents"][0], result["metadatas"][0], result["distances"][0])
        ]

    def delete_document(self, document_id: str) -> None:
        self._collection.delete(where={"document_id": document_id})

    def get_chunk(self, document_id: str, chunk_index: int) -> RetrievedChunk | None:
        result = self._collection.get(ids=[f"{document_id}_{chunk_index}"], include=["documents", "metadatas"])
        if not result["ids"]:
            return None
        return self._to_chunk(result["documents"][0], result["metadatas"][0], distance=None)

    def count(self) -> int:
        return self._collection.count()

    @staticmethod
    def _to_chunk(document: str, metadata: dict, distance: float | None) -> RetrievedChunk:
        page_number = metadata["page_number"]
        return RetrievedChunk(
            document_id=metadata["document_id"],
            filename=metadata["filename"],
            chunk_index=metadata["chunk_index"],
            page_number=None if page_number == _PAGE_NUMBER_NONE_SENTINEL else page_number,
            text=document,
            score=(1 - distance) if distance is not None else 1.0,
            source_name=metadata.get("source_name", metadata["filename"]),
            chunk_id=metadata.get("chunk_id", f"{metadata['document_id']}_{metadata['chunk_index']}"),
            upload_timestamp=metadata.get("upload_timestamp"),
        )
