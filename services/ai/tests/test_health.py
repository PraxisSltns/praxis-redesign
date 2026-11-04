"""The ai service's HTTP surface, with a stand-in for the models (AI_MODELS=off), so tests need no weights."""

import base64
import io
import os

os.environ["AI_MODELS"] = "off"

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.models import BadImage, Cutout, open_image


def png(size=(40, 60), colour=(20, 40, 80)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, colour).save(buf, "PNG")
    return buf.getvalue()


class FakeModels:
    load_ms = 1

    def describe(self):
        return [{"name": "BiRefNet", "task": "cutout"}, {"name": "Marqo-FashionSigLIP", "task": "embed", "dim": 768}]

    def cutout(self, data):
        open_image(data)
        return Cutout(png(), 40, 60, 5)

    def embed_texts(self, texts):
        return [[1.0] + [0.0] * 767 for _ in texts]

    def embed_images(self, images):
        for i in images:
            open_image(i)
        return [[0.0, 1.0] + [0.0] * 766 for _ in images]


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def loaded(client):
    app.state.models = FakeModels()
    yield client
    app.state.models = None


def test_health_answers_ok_with_no_models(client):
    body = client.get("/health").json()
    assert body["ok"] is True and body["service"] == "ai" and body["models"] == []


def test_health_lists_the_models_once_loaded(loaded):
    assert [m["name"] for m in loaded.get("/health").json()["models"]] == ["BiRefNet", "Marqo-FashionSigLIP"]


def test_no_docs_or_schema_are_exposed(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404, path


def test_without_models_cutout_and_embed_say_so(client):
    assert client.post("/cutout", content=png(), headers={"Content-Type": "image/png"}).status_code == 503
    assert client.post("/embed", json={"texts": ["navy blazer"]}).status_code == 503


def test_cutout_returns_a_png(loaded):
    res = loaded.post("/cutout", content=png(), headers={"Content-Type": "image/png"})
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    assert res.headers["x-model"] == "BiRefNet"
    assert Image.open(io.BytesIO(res.content)).size == (40, 60)


def test_cutout_refuses_what_isnt_an_image(loaded):
    assert loaded.post("/cutout", content=b"{}", headers={"Content-Type": "application/json"}).status_code == 415
    assert loaded.post("/cutout", content=b"", headers={"Content-Type": "image/png"}).status_code == 400
    assert loaded.post("/cutout", content=b"not really a png", headers={"Content-Type": "image/png"}).status_code == 422


def test_embed_texts_and_images(loaded):
    res = loaded.post("/embed", json={"texts": ["navy wool blazer", "white sneakers"]}).json()
    assert res["dim"] == 768 and len(res["vectors"]) == 2 and len(res["vectors"][0]) == 768
    res = loaded.post("/embed", json={"images": [base64.b64encode(png()).decode()]}).json()
    assert len(res["vectors"]) == 1 and res["model"] == "Marqo-FashionSigLIP"


def test_embed_refuses_bad_requests(loaded):
    assert loaded.post("/embed", json={}).status_code == 400
    assert loaded.post("/embed", json={"texts": ["a"], "images": ["b"]}).status_code == 400
    assert loaded.post("/embed", json={"texts": ["   "]}).status_code == 400
    assert loaded.post("/embed", json={"images": ["not base64!"]}).status_code == 400
    assert loaded.post("/embed", json={"images": [base64.b64encode(b"nope").decode()]}).status_code == 422
    assert loaded.post("/embed", json={"texts": ["x"] * 33}).status_code == 422


def test_open_image_shrinks_large_photos_and_refuses_junk():
    big = io.BytesIO()
    Image.new("RGB", (4000, 3000)).save(big, "JPEG")
    assert max(open_image(big.getvalue()).size) == 2048
    with pytest.raises(BadImage):
        open_image(b"junk")
