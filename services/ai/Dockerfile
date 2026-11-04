# The ai service (FastAPI). Railway builds it from services/ai; it has no public domain and the gateway
# reaches it at http://ai.railway.internal:$PORT. It binds to HOST, :: by default: Railway's private
# network is IPv6. Uvicorn's :: socket is IPv6 only, so docker-compose sets HOST=0.0.0.0 for the
# IPv4 port mapping on a developer's machine.
FROM python:3.12.16-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOST=:: PORT=8000
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
RUN useradd --create-home --uid 10001 praxis
USER praxis

EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host \"${HOST}\" --port \"${PORT}\""]
