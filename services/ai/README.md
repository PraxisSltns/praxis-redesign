# The ai service

A small FastAPI service for the image and text models the gateway (`server/index.mjs`) calls. It is private: on Railway it has no public domain and the gateway reaches it at `AI_SERVICE_URL`.

Week 1 has only `GET /health`. Cut-outs (`POST /cutout`) and embeddings (`POST /embed`) come in phase 4.

## Run

With the rest of the backend (it's in `docker-compose.yml`):

```bash
npm run dev:up                       # builds and starts it on http://localhost:8000
curl localhost:8000/health
```

On its own, for tests:

```bash
cd services/ai
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `::` | Bind address. `::` is IPv6, which Railway's private network uses. Uvicorn's `::` socket is IPv6 only, so docker-compose sets `0.0.0.0` for the local IPv4 port mapping. |
| `PORT` | `8000` | Set it explicitly on Railway too, so `AI_SERVICE_URL` on the gateway names the same port. |

## Dependencies

`requirements.txt` pins every runtime package, direct and transitive. `requirements-dev.txt` adds the test tools. Both are for Python 3.12, and the image is `python:3.12.16-slim`.

Starlette prints a deprecation warning that its test client wants `httpx2` instead of `httpx`. `httpx` is kept until `httpx2`'s provenance has been checked.
