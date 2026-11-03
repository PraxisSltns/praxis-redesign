# Developing locally

The page (Vite) and the gateway (`server/index.mjs`) run on your machine. Their dependencies (Postgres 16 with pgvector, Redis 7 and S3-compatible storage) run in Docker (`docker-compose.yml`). Nothing here reaches staging, production or a paid service.

Needs Node 22.9 or newer, and Docker Desktop (or another Docker engine with Compose v2).

## First run

```bash
git clone https://github.com/bobibcgroup/praxis-redesign.git
cd praxis-redesign
npm ci
cp .env.example .env        # local defaults; .env is git-ignored
npm run dev:up              # Postgres, Redis and storage, waits until all are healthy
npm run db:migrate          # the database tables (a placeholder until the migrations land)
npm run dev                 # the page on http://localhost:5173
```

The page works on its own: with no gateway, every look comes from the built-in rules engine and any `/api` call fails quietly.

To run the page against your local gateway:

```bash
npm run build               # the gateway serves dist/
npm run dev:api             # the gateway on http://localhost:3000, reading .env
```

Then either open http://localhost:3000 (page and gateway on one origin, like Railway), or set `VITE_API_BASE_URL=http://localhost:3000` in `.env` and keep `npm run dev` on :5173 (the gateway allows it through `CORS_ORIGINS`). Clear `VITE_API_BASE_URL` before `npm run build` again, because Vite compiles it into builds too.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev:up` | Starts the containers and waits until each health check passes. The `s3-bucket` job creates the bucket and exits. |
| `npm run dev:down` | Stops the containers and keeps the data. |
| `npm run dev:reset` | Stops the containers, **deletes their volumes** (database, Redis, bucket) and starts them again empty. |
| `npm run db:migrate` | Applies the database migrations (`server/db/migrations`). |
| `npm run db:seed` | Loads local sample data. |
| `npm run dev:api` | The gateway with `.env` loaded (`npm start` is what Railway runs, with no `.env`). |
| `npm test`, `npm run build`, `npm run e2e` | Unit tests, typecheck and build, the browser scenarios (see `docs/testing-report.md`). |

## The containers

| Service | Image | Port | Health check |
|---|---|---|---|
| `postgres` | `pgvector/pgvector:0.8.0-pg16` | 5432 | `pg_isready` |
| `redis` | `redis:7.4-alpine` (append-only file on) | 6379 | `redis-cli ping` |
| `s3` | `chrislusf/seaweedfs:4.50` (S3 API) | 8333 | `GET /healthz` |
| `s3-bucket` | `amazon/aws-cli:2.39.3` | none | runs once, creates `S3_BUCKET` |

Ports can be moved with `POSTGRES_PORT`, `REDIS_PORT` and `S3_PORT` in `.env` if something else on your machine uses them. Update the matching `DATABASE_URL`, `REDIS_URL` and `S3_ENDPOINT` too.

The decision was MinIO for local storage. MinIO no longer publishes its images: Docker Hub refuses `minio/minio` and `minio/mc`, and quay.io refuses `quay.io/minio/minio` (checked 2026-11-03). SeaweedFS (Apache 2.0) speaks the same S3 API, so code that talks to it with an S3 client talks to a Railway bucket the same way.

Useful checks:

```bash
docker compose ps
docker compose exec postgres psql -U praxis -d praxis -c "CREATE EXTENSION IF NOT EXISTS vector;"
docker compose exec redis redis-cli ping
docker compose run --rm s3-bucket   # make the bucket again (safe if it exists)
```

## Keys and secrets

- `.env` holds local values only and is never committed. `.env.example` is the list of every variable, with safe defaults.
- A `VITE_` variable is compiled into the page that every visitor downloads. Never put a key or secret in one.
- Paid AI stays off locally: leave `GEMINI_API_KEY` empty unless you mean to use the free writer and the budgeted outfit pictures (`docs/AI-HANDOVER.md`).
