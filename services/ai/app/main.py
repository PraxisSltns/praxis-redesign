"""The Praxis ai service: image and text models the gateway calls over the private network.

Week 1 skeleton: only /health. Cut-outs (/cutout) and embeddings (/embed) arrive in phase 4.
The gateway (server/index.mjs) reaches it at AI_SERVICE_URL; it has no public address on Railway.
"""

import os

from fastapi import FastAPI

VERSION = os.environ.get("RAILWAY_GIT_COMMIT_SHA", "local")[:7] or "local"

app = FastAPI(title="Praxis ai service", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health() -> dict:
    """Up when the process answers. Models, once loaded at start-up, are listed here too."""
    return {"ok": True, "service": "ai", "version": app.version, "commit": VERSION, "models": []}
