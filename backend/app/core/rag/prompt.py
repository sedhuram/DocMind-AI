from app.core.config import settings
from app.core.rag.retrieval import RetrievalResult
from app.models.orm import ChatMessage

SYSTEM_INSTRUCTION = (
    "You are DocMind AI, a document question-answering assistant. "
    "Answer only using the information in the numbered sources provided below the question. "
    "Cite the sources you used inline with their bracketed number, e.g. [Source 1]. "
    "If the sources don't contain enough information to answer, say so plainly instead of guessing."
)


def build_contents(query: str, retrieval: RetrievalResult, history: list[ChatMessage]) -> list[dict]:
    contents = []
    for turn in history[-settings.conversation_window_turns :]:
        role = "user" if turn.role == "user" else "model"
        contents.append({"role": role, "parts": [{"text": turn.content}]})

    context = retrieval.context_text or "(no relevant sources found in the document collection)"
    contents.append({"role": "user", "parts": [{"text": f"Sources:\n{context}\n\nQuestion: {query}"}]})
    return contents
