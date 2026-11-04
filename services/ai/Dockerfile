# The ai service (FastAPI). Railway builds it from services/ai; it has no public domain and the gateway
# reaches it at http://ai.railway.internal:$PORT. It binds to HOST, :: by default: Railway's private
# network is IPv6. Uvicorn's :: socket is IPv6 only, so docker-compose sets HOST=0.0.0.0 for the
# IPv4 port mapping on a developer's machine.
#
# The models' weights are fetched once, here, at their pinned revisions (app/models.py), and baked into
# the image: nothing is downloaded at start-up or per request. CUTOUT_MODEL=lite builds the smaller
# cut-out model instead (for small machines).
FROM python:3.12.16-slim

ARG CUTOUT_MODEL=full
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOST=:: PORT=8000 \
    MODELS_DIR=/models CUTOUT_MODEL=${CUTOUT_MODEL} HF_HUB_DISABLE_TELEMETRY=1
WORKDIR /app

# CPU-only torch first (no CUDA libraries), then everything else from PyPI at the pinned versions.
COPY requirements-web.txt requirements.txt ./
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.15.0 torchvision==0.29.2 \
 && pip install --no-cache-dir -r requirements.txt

COPY app ./app
RUN python -m app.download && find /models -name ".cache" -prune -exec rm -rf {} +

RUN useradd --create-home --uid 10001 praxis && chown -R praxis /models
USER praxis
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_HOME=/home/praxis/.cache/huggingface

EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host \"${HOST}\" --port \"${PORT}\""]
