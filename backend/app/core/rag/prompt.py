from typing import Protocol

from app.core.config import settings
from app.core.rag.retrieval import RetrievalResult

SYSTEM_INSTRUCTION = (
    "You are DocMind AI, a document question-answering assistant. "
    "Answer only using the information in the numbered sources provided below the question. "
    "Cite the sources you used inline with their bracketed number, e.g. [Source 1]. "
    "If the sources do not contain enough information to answer the question, or if there is not enough context, "
    "you MUST reply with exactly the phrase: 'Information not found in context'. Do not guess or extrapolate."
)


class HistoryTurnLike(Protocol):
    role: str
    content: str


def build_contents(query: str, retrieval: RetrievalResult, history: list[HistoryTurnLike]) -> list[dict]:
    """Provider-neutral message list: {"role": "user"|"assistant", "content": str}.
    Each generation module (Gemini, Ollama) adapts this shape to its own SDK's format."""
    contents = []
    for turn in history[-settings.conversation_window_turns :]:
        role = "user" if turn.role == "user" else "assistant"
        contents.append({"role": role, "content": turn.content})

    context = retrieval.context_text or "(no relevant sources found in the document collection)"
    contents.append({"role": "user", "content": f"Sources:\n{context}\n\nQuestion: {query}"})
    return contents
