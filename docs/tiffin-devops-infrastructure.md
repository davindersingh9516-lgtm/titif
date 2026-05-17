# Tiffin Platform — DevOps, Deployment & Production Infrastructure

> Single-brand tiffin operation, starting in **Amritsar**, designed to scale to multi-city without re-architecting.
> Today the live system runs on **Lovable Cloud** (Supabase Postgres + Edge runtime + Realtime + pg_cron + pg_net). This document is the production-grade target architecture for when you self-host on a **VPS or AWS**, mirroring the existing data model and workflows 1:1.

---

## 0. Guiding principles

- **Boring tech, strong defaults.** Postgres, Redis, Nginx, Docker, GitHub Actions — nothing exotic.
- **One environment per concern.** `prod`, `staging`, `local`. Never edit prod by hand.
- **Stateless app servers.** All state lives in Postgres / Redis / object storage. Any container can die.
- **Everything in version control.** Infra as code, env templates, migrations, runbooks.
- **Observability before features.** Logs, metrics, alerts wired on day 1.

---

## 1. Production deployment topology

```
                 Cloudflare (DNS + WAF + DDoS + CDN)
                                 │
                          ┌──────┴──────┐
                          │   Nginx     │  TLS termination, HTTP/2, gzip+brotli,
                          │ (host)      │  websocket upgrade, rate limit, security headers
                          └──┬───────┬──┘
            /api, /socket.io │       │ /  (static PWA)
                             │       │
                ┌────────────┘       └────────────┐
                │                                 │
        ┌───────▼────────┐               ┌────────▼────────┐
        │  api (NestJS)  │  x N replicas │  web (Next.js)  │  x N replicas
        │  PM2 cluster   │               │  PM2 / static   │
        └─┬───────┬───┬──┘               └─────────────────┘
          │       │   │
   ┌──────▼─┐ ┌───▼──┐ ┌▼───────────┐
   │Postgres│ │Redis │ │ Object S3  │  (R2 / S3 — invoices, menu images)
   │ + PITR │ │ +AOF │ │            │
   └────────┘ └──────┘ └────────────┘
```

**Roles**

| Service          | Purpose                                                          |
| ---------------- | ---------------------------------------------------------------- |
| Cloudflare       | DNS, TLS, WAF, DDoS, edge cache for static assets                |
| Nginx            | Reverse proxy, TLS, HTTP/2, websocket upgrade, gzip+brotli       |
| `web`            | Next.js PWA, SSR/ISR for marketing pages, customer/admin/rider   |
| `api`            | NestJS HTTP + Socket.IO, BullMQ workers (or split worker)        |
| `worker`         | Dedicated NestJS process for BullMQ queues (notifications, cron) |
| Postgres         | Primary DB, single writer, async streaming replica for backups   |
| Redis            | Cache, BullMQ queue, Socket.IO adapter, rate-limit counters      |
| Object storage   | Invoice PDFs, menu images, rider proof-of-delivery photos        |

**Environments**

| Env       | Domain                 | Branch     | Notes                              |
| --------- | ---------------------- | ---------- | ---------------------------------- |
| `local`   | `localhost`            | any        | docker-compose, hot reload         |
| `staging` | `staging.tiffin.app`   | `develop`  | Full prod parity, anonymized data  |
| `prod`    | `tiffin.app`           | `main`     | Tagged releases only               |

---

## 2. Repository layout

```
tiffin/
├── apps/
│   ├── web/                # Next.js (customer + admin + rider PWA)
│   └── api/                # NestJS (HTTP + Socket.IO + workers)
├── packages/
│   ├── db/                 # Prisma schema + migrations + seed
│   ├── shared/             # Zod schemas, DTOs, constants
│   └── config/             # Eslint, tsconfig, tailwind preset
├── infra/
│   ├── docker/
│   │   ├── api.Dockerfile
│   │   ├── web.Dockerfile
│   │   └── worker.Dockerfile
│   ├── docker-compose.yml          # local dev
│   ├── docker-compose.prod.yml     # single-node prod
│   ├── nginx/
│   │   ├── nginx.conf
│   │   └── conf.d/tiffin.conf
│   ├── pm2/ecosystem.config.cjs
│   └── scripts/
│       ├── deploy.sh
│       ├── backup-postgres.sh
│       ├── backup-redis.sh
│       └── restore-postgres.sh
├── .github/workflows/
│   ├── ci.yml
│   ├── deploy-staging.yml
│   └── deploy-prod.yml
├── .env.example
└── README.md
```

---

## 3. Docker architecture

**One image per app.** Multi-stage, non-root, distroless/alpine, no dev deps in final layer.

`infra/docker/api.Dockerfile`:

```dockerfile
# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json bun.lockb tsconfig*.json ./
COPY apps/api ./apps/api
COPY packages ./packages
RUN bun install --frozen-lockfile
RUN bun run --filter @tiffin/api build

# ---- runtime ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/apps/api/dist ./dist
COPY --from=build --chown=app:app /app/apps/api/package.json ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:4000/health || exit 1
CMD ["node", "dist/main.js"]
```

`infra/docker-compose.prod.yml` (single-node deployment):

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: always
    volumes: [pgdata:/var/lib/postgresql/data]
    environment:
      POSTGRES_USER: ${PG_USER}
      POSTGRES_PASSWORD: ${PG_PASSWORD}
      POSTGRES_DB: tiffin
    command: ["postgres", "-c", "max_connections=200", "-c", "shared_buffers=512MB"]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U ${PG_USER}"], interval: 10s }

  redis:
    image: redis:7-alpine
    restart: always
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "512mb",
              "--maxmemory-policy", "allkeys-lru", "--requirepass", "${REDIS_PASSWORD}"]
    volumes: [redisdata:/data]

  api:
    image: ghcr.io/tiffin/api:${TAG}
    restart: always
    env_file: .env.prod
    depends_on: { postgres: { condition: service_healthy }, redis: { condition: service_started } }
    deploy: { replicas: 2 }
    expose: ["4000"]

  worker:
    image: ghcr.io/tiffin/api:${TAG}
    restart: always
    command: ["node", "dist/worker.js"]
    env_file: .env.prod
    depends_on: [postgres, redis]

  web:
    image: ghcr.io/tiffin/web:${TAG}
    restart: always
    env_file: .env.prod
    expose: ["3000"]

  nginx:
    image: nginx:1.27-alpine
    restart: always
    ports: ["80:80", "443:443"]
    volumes:
      - ./infra/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./infra/nginx/conf.d:/etc/nginx/conf.d:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on: [api, web]

volumes: { pgdata: {}, redisdata: {} }
```

---

## 4. Nginx configuration

`infra/nginx/conf.d/tiffin.conf`:

```nginx
limit_req_zone   $binary_remote_addr zone=api:10m  rate=20r/s;
limit_req_zone   $binary_remote_addr zone=otp:10m  rate=1r/s;
limit_conn_zone  $binary_remote_addr zone=conn:10m;

upstream api_upstream { least_conn; server api:4000; keepalive 64; }
upstream web_upstream { server web:3000; keepalive 64; }

server { listen 80; server_name tiffin.app; return 301 https://$host$request_uri; }

server {
  listen 443 ssl http2;
  server_name tiffin.app;

  ssl_certificate     /etc/letsencrypt/live/tiffin.app/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/tiffin.app/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;
  ssl_session_cache shared:SSL:10m;

  # security headers
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options DENY always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;
  add_header Permissions-Policy "geolocation=(self), camera=()" always;
  add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://tiffin.app https://*.lovable.app; frame-ancestors 'none'" always;

  gzip on; gzip_types text/plain application/json application/javascript text/css image/svg+xml;
  brotli on; brotli_types text/plain application/json application/javascript text/css;
  client_max_body_size 8m;

  limit_conn conn 50;

  # OTP endpoint — strict
  location = /api/auth/otp { limit_req zone=otp burst=2 nodelay; proxy_pass http://api_upstream; }

  # API
  location /api/ {
    limit_req zone=api burst=40 nodelay;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_pass http://api_upstream;
  }

  # Socket.IO — sticky via Redis adapter, long-lived
  location /socket.io/ {
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_pass http://api_upstream;
  }

  # Web (Next.js)
  location / { proxy_pass http://web_upstream; }
  location /_next/static/ { proxy_pass http://web_upstream; expires 1y; add_header Cache-Control "public, immutable"; }
}
```

TLS via **certbot**, auto-renew with `0 3 * * * certbot renew --quiet --deploy-hook "docker exec nginx nginx -s reload"`.

---

## 5. PostgreSQL production

**Settings (16 GB RAM box):**

| Param                  | Value     |
| ---------------------- | --------- |
| `max_connections`      | 200       |
| `shared_buffers`       | 4GB       |
| `effective_cache_size` | 12GB      |
| `work_mem`             | 16MB      |
| `maintenance_work_mem` | 512MB     |
| `wal_level`            | replica   |
| `max_wal_senders`      | 5         |
| `wal_keep_size`        | 2GB       |
| `checkpoint_timeout`   | 15min     |
| `random_page_cost`     | 1.1 (SSD) |

**Connection pooling:** **PgBouncer** in `transaction` mode in front of Postgres. App points at PgBouncer (port 6432). Set Prisma `connection_limit=10` per replica.

**Indexes already in place** (mirror current Lovable schema):
- `orders(status, created_at)`
- `orders(delivery_date, meal_type, delivery_window)`
- `notifications(user_id, read_at)`, `notifications(user_id, created_at desc)`
- `notification_log(status, scheduled_for) where status in ('queued','retry')`

**Backups** (defense in depth):
1. **PITR** via `pg_basebackup` + WAL archive to S3/R2 — recovery to any second within 14 days.
2. **Nightly logical** `pg_dump` (custom format), retained 30 daily / 12 monthly.
3. **Weekly restore drill** to a throwaway box — automated and alerted on failure. *A backup you have not restored is not a backup.*

`infra/scripts/backup-postgres.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
FILE=/tmp/tiffin-${TS}.dump
docker exec -t postgres pg_dump -U "$PG_USER" -Fc -d tiffin > "$FILE"
aws s3 cp "$FILE" "s3://$BACKUP_BUCKET/postgres/$TS.dump" --storage-class STANDARD_IA
aws s3 ls "s3://$BACKUP_BUCKET/postgres/" | sort | head -n -30 \
  | awk '{print $4}' | xargs -I {} aws s3 rm "s3://$BACKUP_BUCKET/postgres/{}"
rm "$FILE"
```

Cron: `15 2 * * * /opt/tiffin/infra/scripts/backup-postgres.sh >> /var/log/tiffin/backup.log 2>&1`.

**Scaling roadmap**
1. Vertical first (4 → 8 → 16 vCPU). Most tiffin workloads are write-light.
2. Read replica for analytics RPCs (`admin_kpis`, `admin_daily_series`, `super_overview`).
3. Move heavy reporting to a nightly materialized view set.
4. Partition `orders` by month once > 5M rows.

---

## 6. Redis production

- Single primary + AOF (`appendonly yes`, `appendfsync everysec`) for durability.
- `maxmemory 512mb`, `maxmemory-policy allkeys-lru` for cache; **separate logical DB** for BullMQ (`db=1`) and Socket.IO adapter (`db=2`) to keep eviction from killing queues.
- Snapshots (`save 900 1 300 10`) plus AOF; daily snapshot to S3.
- Production move: **Redis Sentinel** (3 nodes) once you cross ~5k concurrent sockets; switch to **Redis Cluster** only at multi-city scale.

---

## 7. Socket.IO scaling

- `@socket.io/redis-adapter` so any `api` replica can broadcast to riders / customers across the whole cluster.
- Nginx upgrades on `/socket.io/` (see §4); no sticky sessions needed when using the Redis adapter + websocket transport (disable long-polling fallback in prod: `transports: ['websocket']`).
- Heartbeat every 20s (already shipped via `rider_heartbeat` RPC).
- Per-namespace channels: `customer:{userId}`, `order:{orderId}`, `rider:{riderId}`, `admin:ops`.
- Backpressure: drop rider location updates older than the latest one in the queue (per-rider Redis key with TTL 30s).

---

## 8. Environment variables

`.env.example` (committed — **never** commit `.env.prod`):

```bash
# --- runtime ---
NODE_ENV=production
PORT=4000

# --- database ---
DATABASE_URL=postgres://tiffin:***@pgbouncer:6432/tiffin?schema=public
DIRECT_URL=postgres://tiffin:***@postgres:5432/tiffin?schema=public

# --- redis ---
REDIS_URL=redis://:***@redis:6379/0
BULLMQ_REDIS_URL=redis://:***@redis:6379/1
SOCKETIO_REDIS_URL=redis://:***@redis:6379/2

# --- auth ---
JWT_SECRET=
OTP_PEPPER=

# --- whatsapp cloud api ---
WHATSAPP_TOKEN=
WHATSAPP_PHONE_ID=
WHATSAPP_VERIFY_TOKEN=

# --- payments (UPI) ---
UPI_MERCHANT_VPA=
UPI_MERCHANT_NAME=

# --- object storage ---
S3_ENDPOINT=
S3_BUCKET=tiffin-assets
S3_ACCESS_KEY=
S3_SECRET_KEY=

# --- observability ---
SENTRY_DSN=
GRAFANA_PUSH_URL=
LOG_LEVEL=info

# --- ops ---
BACKUP_BUCKET=tiffin-backups
ADMIN_ALERT_WEBHOOK=
```

**Secrets management**
- VPS: `.env.prod` lives only on the host at `/etc/tiffin/env`, mode `600`, owned by `app` user. Rotated quarterly.
- AWS: **AWS Secrets Manager** + IAM role on the EC2/ECS task; injected at boot via `entrypoint.sh`.
- GitHub Actions: **Repository secrets** for deploy keys + image registry; never raw runtime secrets.

---

## 9. CI/CD with GitHub Actions

**`.github/workflows/ci.yml`** — runs on every PR:

```yaml
name: ci
on: { pull_request: {}, push: { branches: [main, develop] } }
jobs:
  build:
    runs-on: ubuntu-latest
    services:
      postgres: { image: postgres:16, env: { POSTGRES_PASSWORD: pg }, ports: ["5432:5432"], options: --health-cmd "pg_isready" }
      redis:    { image: redis:7,    ports: ["6379:6379"] }
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run typecheck
      - run: bun run test -- --coverage
        env: { DATABASE_URL: postgres://postgres:pg@localhost:5432/postgres }
      - run: bun run build
```

**`.github/workflows/deploy-prod.yml`** — runs on tag `v*`:

```yaml
name: deploy-prod
on: { push: { tags: ['v*'] } }
concurrency: { group: deploy-prod, cancel-in-progress: false }
jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }} }
      - uses: docker/build-push-action@v6
        with: { context: ., file: infra/docker/api.Dockerfile, push: true,
                tags: ghcr.io/tiffin/api:${{ github.ref_name }},ghcr.io/tiffin/api:latest, cache-from: type=gha, cache-to: type=gha,mode=max }
      - uses: docker/build-push-action@v6
        with: { context: ., file: infra/docker/web.Dockerfile, push: true,
                tags: ghcr.io/tiffin/web:${{ github.ref_name }},ghcr.io/tiffin/web:latest }

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.PROD_HOST }}
          username: deploy
          key: ${{ secrets.PROD_SSH_KEY }}
          script: |
            cd /opt/tiffin
            export TAG=${{ github.ref_name }}
            docker compose -f infra/docker-compose.prod.yml pull
            docker compose -f infra/docker-compose.prod.yml run --rm api node dist/migrate.js
            docker compose -f infra/docker-compose.prod.yml up -d --remove-orphans
            docker image prune -f
```

**Rollback**: `TAG=v1.4.2 docker compose -f infra/docker-compose.prod.yml up -d` — images are immutable and cached on the host.

---

## 10. Monitoring & logging

**Stack** (single VPS-friendly): **Grafana Cloud free tier** + **Loki** + **Prometheus node exporter** + **Sentry**.

| Concern              | Tool                         | What we capture                                        |
| -------------------- | ---------------------------- | ------------------------------------------------------ |
| Errors (FE + BE)     | Sentry                       | Stack traces, release tag, user, breadcrumbs           |
| Logs                 | Loki + Promtail              | All container stdout, JSON-structured                  |
| Host metrics         | Prometheus node-exporter     | CPU, RAM, disk, network                                |
| App metrics          | `prom-client` in NestJS      | HTTP RED, queue depth, socket count, RPC latency       |
| Postgres metrics     | `postgres_exporter`          | TPS, locks, replication lag, slow queries              |
| Uptime               | Better Stack / UptimeRobot   | Public health checks every 60s from 3 regions          |
| Realtime tracing     | OpenTelemetry → Tempo        | Request → DB → queue → socket spans                    |

**Structured log format** (NestJS + pino):

```json
{ "time":"2026-05-11T18:32:11Z","level":"info","reqId":"01H...","userId":"...","route":"POST /api/orders","ms":42,"status":201 }
```

**Alert rules** (PagerDuty / Slack `#alerts-prod`):
- 5xx rate > 1% over 5 min → page
- p95 API latency > 800 ms over 10 min → page
- Postgres replication lag > 30 s → page
- BullMQ failed queue > 50 → warn
- Disk free < 15% → page
- WhatsApp dispatcher `failed` > 10/min → warn
- Socket.IO connected riders < expected during meal window → warn

---

## 11. Security infrastructure

- **Cloudflare** in front of Nginx: WAF managed rules + bot fight + DDoS L3/L4/L7.
- **Fail2ban** on the host for SSH brute force.
- **UFW**: only `22` (key-only, non-default port), `80`, `443` open.
- **SSH**: keys only, no passwords, deploy user has no shell except `bash` for `appleboy/ssh-action`, sudo NOPASSWD only for `docker compose`.
- **Rate limits**: Nginx (§4) + per-user limits in NestJS (`@nestjs/throttler` backed by Redis).
- **OTP**: 4-digit, hashed with pepper, 5 min TTL, max 5 attempts, 60s resend cooldown — already enforced server-side.
- **RLS everywhere** (matches the current Supabase posture); `is_admin()`, `has_role()` SECURITY DEFINER helpers, `search_path` locked.
- **Secrets rotation**: JWT_SECRET, OTP_PEPPER, WHATSAPP_TOKEN, DB passwords every 90 days; runbook in `docs/runbooks/rotate-secrets.md`.
- **Dependency scanning**: `bun audit` in CI, Dependabot weekly, Snyk free tier on `main`.
- **CSP + HSTS + X-Frame-Options + Referrer-Policy + Permissions-Policy** in Nginx (§4).

---

## 12. Backup & disaster recovery

**RPO = 5 min, RTO = 30 min.**

| Asset           | Strategy                                   | Location               | Retention   |
| --------------- | ------------------------------------------ | ---------------------- | ----------- |
| Postgres        | WAL archive every 60s + nightly `pg_dump`  | S3 (Glacier IR weekly) | 30d / 12mo  |
| Redis           | RDB snapshot daily + AOF                   | S3                     | 14d         |
| Object storage  | Versioning + cross-region replication      | S3 + R2 mirror         | 90d         |
| Code            | Git (GitHub) + monthly off-site clone      | Codeberg mirror        | infinite    |
| Infra config    | Repo `infra/` + `.env.example`             | Git                    | infinite    |

**Disaster runbook** (single-node death):
1. Provision new VPS from snapshot AMI (Terraform module in `infra/terraform/`).
2. `infra/scripts/restore-postgres.sh s3://.../<latest>.dump` → restores schema + data.
3. `docker compose pull && docker compose up -d`.
4. Cloudflare DNS swap (TTL 60s).
5. Verify: `/health`, place test order, recharge wallet ₹1, deliver test order with rider account.

Drill quarterly. Document the time taken; if RTO drifts > 30 min, fix.

---

## 13. Performance optimization

**Frontend**
- Next.js: ISR for `/menu`, SSG for marketing, dynamic imports for admin/rider bundles.
- PWA: precache shell + last 10 menu images via Workbox; offline cart support.
- `next/image` everywhere; AVIF/WebP; LCP target < 2.0s on 4G.
- Tailwind JIT + tree-shaken Lucide icons (`lucide-react/icons/...`).

**Backend**
- Redis cache for `menu_items` (TTL 60s), `app_settings` (TTL 5 min), wallet balance per user (TTL 30s, invalidated on tx).
- All hot endpoints under 100ms p50, 300ms p95.
- N+1 killed via Prisma `select`/`include`; admin lists paginated server-side.
- BullMQ concurrency tuned per queue: `notifications=20`, `lock-orders=1`, `analytics-rollup=2`.

**Database**
- Indexes from §5 + `EXPLAIN ANALYZE` review on every new RPC.
- `pg_stat_statements` enabled; weekly review of top 10 slow queries.

---

## 14. Cost outline (Amritsar, year 1)

| Item                              | Monthly USD |
| --------------------------------- | ----------- |
| Hetzner CPX31 VPS (4vCPU/8GB/160GB) | $16       |
| Cloudflare (free → Pro later)     | $0–20       |
| S3-compatible storage (R2)        | $1–5        |
| Sentry (Developer)                | $0          |
| Grafana Cloud (free)              | $0          |
| Backup egress                     | $1–3        |
| Domain + email                    | $2          |
| **Total**                         | **~$25–50** |

Scales linearly until ~10k daily orders before needing managed Postgres / second app node.

---

## 15. Scaling roadmap

| Stage           | Trigger                                      | Action                                                |
| --------------- | -------------------------------------------- | ----------------------------------------------------- |
| **Single node** | Today                                        | docker-compose on one VPS                             |
| **Split**       | CPU > 60% sustained                          | Move Postgres + Redis to managed (Neon, Upstash)      |
| **HA app**      | > 2k DAU                                     | 2× app nodes behind Nginx LB, Redis adapter on        |
| **Multi-AZ**    | First city expansion                         | RDS Multi-AZ, ElastiCache, ALB, ECS Fargate           |
| **Multi-city**  | > 5 cities                                   | City-scoped read replicas, geo-routed Cloudflare      |
| **Kubernetes**  | Only when 3+ engineers can on-call           | EKS, ArgoCD — *not before*                            |

---

## 16. Production readiness checklist

- [ ] DNS + Cloudflare proxied, TLS A+ on SSL Labs
- [ ] HSTS preloaded, CSP enforced (no `unsafe-eval`)
- [ ] All secrets in Secrets Manager / `/etc/tiffin/env` (mode 600)
- [ ] Postgres PITR verified by restore drill
- [ ] Redis AOF + daily snapshot to S3
- [ ] Sentry receiving FE + BE errors with release tag
- [ ] Loki receiving structured JSON logs from all containers
- [ ] Uptime checks for `/`, `/api/health`, `/socket.io/?EIO=4&transport=websocket`
- [ ] Alert routes to Slack `#alerts-prod` and on-call PagerDuty
- [ ] CI green, deploy-prod requires tag + manual approval
- [ ] Rate limits live on `/api/auth/otp`, `/api/orders`, `/api/wallet/recharge`
- [ ] WhatsApp Cloud API verified, templates approved
- [ ] Rider PWA installed on test devices, geolocation permission flow tested
- [ ] Cutoff cron (`lock-orders-every-5min`) and notification dispatcher running
- [ ] Backup restore drill scheduled quarterly
- [ ] Runbooks committed: `incident.md`, `rotate-secrets.md`, `restore-db.md`, `swap-domain.md`
- [ ] On-call rotation defined with escalation path

---

## 17. Bridge from current Lovable Cloud setup

Today the platform already runs on a managed equivalent:

| Production component       | Lovable Cloud equivalent (today)                                |
| -------------------------- | --------------------------------------------------------------- |
| Postgres + RLS             | Supabase Postgres (already in use)                              |
| Auth + OTP                 | Supabase Auth phone OTP                                         |
| Realtime (Socket.IO)       | Supabase Realtime (postgres_changes on `notifications`, etc.)   |
| BullMQ workers             | `pg_cron` + `pg_net` calling `/api/public/hooks/*` server routes|
| Object storage             | (add Supabase Storage when invoices/photos go live)             |
| Edge runtime / Nginx       | Lovable Worker runtime (Cloudflare-class)                       |
| CI/CD                      | Lovable preview + publish                                       |

When you're ready to move:
1. Export schema with `supabase db dump` → import into self-hosted Postgres.
2. Re-implement the RPCs verbatim (they're plain SQL — already portable).
3. Swap Realtime for Socket.IO + Redis adapter; channel naming stays the same.
4. Replace `pg_cron + pg_net` with BullMQ + a dedicated worker container.
5. Cut DNS over to Nginx; keep Lovable preview as the staging URL during migration.

The data model, RLS policies, RPCs, and front-end code do not change — only the runtime under them does.
