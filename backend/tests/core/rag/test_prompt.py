from app.core.rag.prompt import build_contents, SYSTEM_INSTRUCTION
from app.core.rag.retrieval import RetrievalResult
from app.models.orm import ChatMessage


def test_system_instruction_requires_grounded_answers():
    assert "only" in SYSTEM_INSTRUCTION.lower()
    assert "cite" in SYSTEM_INSTRUCTION.lower()


def test_build_contents_includes_context_and_question():
    retrieval = RetrievalResult(chunks=[], context_text="[Source 1: a.txt]\nsome fact", top_score=0.9, is_low_confidence=False)

    contents = build_contents("what is the fact?", retrieval, history=[])

    assert contents[-1]["role"] == "user"
    text = contents[-1]["parts"][0]["text"]
    assert "some fact" in text
    assert "what is the fact?" in text


def test_build_contents_caps_history_to_conversation_window():
    retrieval = RetrievalResult(chunks=[], context_text="", top_score=0.0, is_low_confidence=True)
    history = [
        ChatMessage(id=str(i), role="user" if i % 2 == 0 else "assistant", content=f"turn {i}")
        for i in range(10)
    ]

    contents = build_contents("new question", retrieval, history)

    # 4 history turns + 1 new question turn
    assert len(contents) == 5
    assert contents[0]["parts"][0]["text"] == "turn 6"


def test_build_contents_handles_no_relevant_sources():
    retrieval = RetrievalResult(chunks=[], context_text="", top_score=0.0, is_low_confidence=True)

    contents = build_contents("anything", retrieval, history=[])

    assert "no relevant sources" in contents[-1]["parts"][0]["text"].lower()
