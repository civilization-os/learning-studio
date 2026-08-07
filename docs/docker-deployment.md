# Docker deployment

The production setup runs two containers:

- `web` serves the built frontend with Nginx and proxies `/api` to the backend.
- `backend` runs the TypeScript API and is only exposed inside the Compose network.

Projects are stored in the `learning-studio-data` volume. Provider keys entered through Settings are encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY`.

## Quick start

Requirements: Docker Engine 24+ (or Docker Desktop) and Docker Compose v2.

```bash
cp deploy/docker.env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Put the generated value in `.env` as `APP_ENCRYPTION_KEY`, then generate and set the login-token signing key (**required in production**; the backend fails to start without it):

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Put that output in `.env` as `JWT_SECRET`, then run:

```bash
docker compose up -d --build
```

Open `http://127.0.0.1:8080`.

Keep `APP_ENCRYPTION_KEY` stable and store it in a password manager or secret manager. Losing or changing it makes saved provider keys unreadable. Never commit `.env`.

Useful commands:

```bash
docker compose ps
docker compose logs -f
docker compose down
```

`docker compose down` keeps the data volume. `docker compose down -v` deletes it.

## Email verification codes (SMTP)

Registration codes are sent over SMTP. All variables are optional; without them the production backend refuses to send codes ("邮件服务尚未配置").

Configure in `.env`:

```dotenv
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
SMTP_ALLOW_INSECURE_TLS=false
MAIL_ECHO_CODE=false
```

- `SMTP_HOST`: SMTP server address. It does **not** have to be a mainstream provider (163/QQ/Gmail). Self-hosted fake mail servers such as Mailpit / MailHog / smtp4dev, or any external SMTP relay, work as long as the address and port are reachable.
- `SMTP_SECURE`: set to `true` for port 465 or SSL.
- `SMTP_USER` / `SMTP_PASSWORD`: sender credentials; leave empty for unauthenticated fake SMTP servers.
- `SMTP_FROM`: sender display address (e.g. `noreply@your-domain.com`). It may be a **non-existent address** — landing in the recipient's spam folder does not affect functionality.
- `SMTP_ALLOW_INSECURE_TLS`: set to `true` to skip certificate verification when connecting to fake SMTP servers with self-signed/invalid certificates.
- `MAIL_ECHO_CODE`: testing switch. Set `true` when no SMTP is available at all — the code is echoed on the page and logged (same as local dev mode). Fine for temporary deployments; not recommended for public production.

## Legacy data migration (store.json → SQLite)

New builds store data in SQLite. When upgrading from an older version, any data still in `server/data/store.json` (or a custom `APP_STORE_PATH`) is automatically imported to the **first registered account** (projects, AI/search settings, encrypted API keys); the file is then renamed to `store.json.migrated`.

To assign the legacy data to an **existing** account instead, run:

```bash
npm run server:build
node scripts/migrate-store.mjs --email user@example.com
# or by username: node scripts/migrate-store.mjs --username alice
```

Restart after changing values:

```bash
docker compose up -d
```

## Network exposure

The safe default binds the app to `127.0.0.1`. To serve it from another machine, set these values in `.env`:

```dotenv
BIND_ADDRESS=0.0.0.0
APP_PORT=8080
```

Before exposing the app to the public internet, place it behind HTTPS and authentication, a VPN, or a zero-trust gateway. CORS is not authentication and does not protect the settings or generation endpoints.

See the [Chinese deployment guide](./docker-deployment.zh-CN.md) for backup, update, and troubleshooting instructions.
