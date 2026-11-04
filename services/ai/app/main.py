"""The Praxis ai service: image and text models the gateway calls over the private network.

- GET  /health   up, and which models are loaded (with their revisions and licences)
- POST /cutout   an image's bytes in (Content-Type image/*), the garment as a trimmed PNG out
- POST /embed    {"texts": [...]} or {"images": [base64, ...]} in, normalised 768-number vectors out

Both models load once at start-up (app/models.py) from MODELS_DIR, never per request. AI_MODELS=off
starts without them (tests, CI): /cutout and /embed then answer 503. Inference runs one call at a
time, off the event loop, so a burst of requests queues instead of multiplying memory.
The gateway (server/index.mjs) reaches it at AI_SERVICE_URL; it has no public address on Railway.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.models import EMBED_DIM, BadImage

VERSION = os.environ.get("RAILWAY_GIT_COMMIT_SHA", "local")[:7] or "local"
MAX_IMAGE_BYTES = 15 * 1024 * 1024
MAX_BATCH = 32


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.models = None
    app.state.lock = asyncio.Lock()
    if os.environ.get("AI_MODELS", "on") != "off":
        from app.models import Models

        app.state.models = await asyncio.to_thread(Models)
    yield


app = FastAPI(title="Praxis ai service", version="0.2.0", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


def models(request: Request):
    m = request.app.state.models
    if m is None:
        raise HTTPException(503, "The models are not loaded on this server.")
    return m


async def run(request: Request, fn, *args):
    """One inference at a time, in a worker thread."""
    async with request.app.state.lock:
        return await asyncio.to_thread(fn, *args)


@app.get("/health")
def health(request: Request) -> dict:
    m = request.app.state.models
    return {
        "ok": True,
        "service": "ai",
        "version": app.version,
        "commit": VERSION,
        "models": m.describe() if m else [],
        **({"loadMs": m.load_ms} if m else {}),
    }


@app.post("/cutout")
async def cutout(request: Request) -> Response:
    m = models(request)
    if not request.headers.get("content-type", "").startswith("image/"):
        raise HTTPException(415, "Send the image's bytes with an image/* Content-Type.")
    data = await request.body()
    if not data:
        raise HTTPException(400, "No image was sent.")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "The image is larger than 15 MB.")
    try:
        out = await run(request, m.cutout, data)
    except BadImage as e:
        raise HTTPException(422, str(e)) from e
    return Response(out.png, media_type="image/png", headers={"X-Model": m.describe()[0]["name"], "X-Elapsed-Ms": str(out.ms), "X-Width": str(out.width), "X-Height": str(out.height)})


class EmbedRequest(BaseModel):
    texts: list[str] | None = Field(default=None, max_length=MAX_BATCH)
    images: list[str] | None = Field(default=None, max_length=MAX_BATCH, description="base64 image bytes")


@app.post("/embed")
async def embed(body: EmbedRequest, request: Request) -> dict:
    m = models(request)
    if bool(body.texts) == bool(body.images):
        raise HTTPException(400, "Send either texts or images, not both or neither.")
    started = time.perf_counter()
    if body.texts:
        texts = [t.strip()[:300] for t in body.texts]
        if not all(texts):
            raise HTTPException(400, "A text is empty.")
        vectors = await run(request, m.embed_texts, texts)
    else:
        try:
            images = [base64.b64decode(i, validate=True) for i in body.images]
        except (binascii.Error, ValueError) as e:
            raise HTTPException(400, "An image is not valid base64.") from e
        if any(len(i) > MAX_IMAGE_BYTES for i in images):
            raise HTTPException(413, "An image is larger than 15 MB.")
        try:
            vectors = await run(request, m.embed_images, images)
        except BadImage as e:
            raise HTTPException(422, str(e)) from e
    return {"model": m.describe()[1]["name"], "dim": EMBED_DIM, "vectors": vectors, "ms": int((time.perf_counter() - started) * 1000)}
