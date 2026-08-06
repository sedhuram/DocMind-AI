from unittest.mock import MagicMock, patch

from app.services import embedding_service


def _fake_embedding(values):
    fake = MagicMock()
    fake.values = values
    return fake


def test_embed_documents_returns_empty_list_for_empty_input():
    assert embedding_service.embed_documents([]) == []


@patch("app.services.embedding_service._client")
def test_embed_documents_normalizes_vectors(mock_client):
    mock_result = MagicMock()
    mock_result.embeddings = [_fake_embedding([3.0, 4.0])]
    mock_client.models.embed_content.return_value = mock_result

    vectors = embedding_service.embed_documents(["some text"])

    assert len(vectors) == 1
    magnitude = sum(v ** 2 for v in vectors[0]) ** 0.5
    assert abs(magnitude - 1.0) < 1e-6


@patch("app.services.embedding_service._client")
def test_embed_query_uses_retrieval_query_task_type(mock_client):
    mock_result = MagicMock()
    mock_result.embeddings = [_fake_embedding([1.0, 0.0])]
    mock_client.models.embed_content.return_value = mock_result

    embedding_service.embed_query("what is docmind?")

    _, kwargs = mock_client.models.embed_content.call_args
    assert kwargs["config"].task_type == "RETRIEVAL_QUERY"
