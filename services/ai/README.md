# The ai service

A small FastAPI service for the image and text models the gateway (`server/index.mjs`) calls. It is private: on Railway it has no public domain and the gateway reaches it at `AI_SERVICE_URL`.

| Endpoint | In | Out |
|---|---|---|
| `GET /health` | | `ok`, the loaded models with repository, revision and licence, `loadMs` |
| `POST /cutout` | an image's bytes, `Content-Type: image/*`, up to 15 MB | the garment as a PNG with a transparent background, trimmed to it; `X-Model`, `X-Elapsed-Ms` |
| `POST /embed` | `{"texts": [...]}` or `{"images": [base64, ...]}`, up to 32 | `{"model", "dim": 768, "vectors": [...], "ms"}`, each vector normalised |

The models (`app/models.py`) are BiRefNet for cut-outs and Marqo-FashionSigLIP for vectors, pinned to exact revisions. They load once at start-up from `MODELS_DIR` and never download at run time. `app/download.py` fetches them, and the Dockerfile runs it at build time, so the weights are in the image. Inference runs one call at a time. Cut-outs take tens of seconds on CPU, so only the batch job asks for them (`server/catalogue/process.mjs`). Licences: `docs/integration-dependencies.md`, "Licence inventory".

## Run

With the rest of the backend (it's in `docker-compose.yml`):

```bash
npm run dev:up                       # builds and starts it on http://localhost:8000
curl localhost:8000/health
```

On its own, with the models (on a small machine, use the smaller cut-out model; see `docs/development.md`):

```bash
cd services/ai
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m app.download     # the pinned weights into .models/ (CUTOUT_MODEL=lite for the small one)
cd ../.. && npm run ai:dev
```

Tests use a stand-in for the models (`AI_MODELS=off`) and need no weights or torch:

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `::` | Bind address. `::` is IPv6, which Railway's private network uses. Uvicorn's `::` socket is IPv6 only, so docker-compose sets `0.0.0.0` for the local IPv4 port mapping. |
| `PORT` | `8000` | Set it explicitly on Railway too, so `AI_SERVICE_URL` on the gateway names the same port. |
| `CUTOUT_MODEL` | `full` | `full` (BiRefNet) or `lite` (BiRefNet_lite). In the image it's a build argument, because the weights are baked in. |
| `MODELS_DIR` | `/models` in the image, `.models/` locally | Where the weights are. |
| `AI_MODELS` | `on` | `off` starts without models. `/cutout` and `/embed` then answer 503 (for tests). |
| `TORCH_THREADS` | PyTorch's default | CPU threads for inference. |

## Dependencies

Every package is pinned, direct and transitive, for Python 3.12. The image is `python:3.12.16-slim`.
- `requirements-web.txt`: FastAPI and Uvicorn.
- `requirements.txt`: the web layer plus the models' stack. The Dockerfile installs torch from PyTorch's CPU index.
- `requirements-dev.txt`: the web layer, Pillow and the test tools, with no torch.

The test client uses `httpx2`, Starlette's recommended client. It's by the author of `httpx`, maintained under the pydantic organisation, and `huggingface_hub` depends on it.
