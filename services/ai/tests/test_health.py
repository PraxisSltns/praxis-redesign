from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_answers_ok():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["service"] == "ai"
    assert body["models"] == []


def test_only_health_is_served():
    # No API docs or schema are exposed: the service is private, and nothing else exists yet.
    for path in ("/docs", "/redoc", "/openapi.json", "/cutout", "/embed"):
        assert client.get(path).status_code == 404, path
