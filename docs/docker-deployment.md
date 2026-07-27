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

Put the generated value in `.env` as `APP_ENCRYPTION_KEY`, then run:

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

## Network exposure

The safe default binds the app to `127.0.0.1`. To serve it from another machine, set these values in `.env`:

```dotenv
BIND_ADDRESS=0.0.0.0
APP_PORT=8080
```

Before exposing the app to the public internet, place it behind HTTPS and authentication, a VPN, or a zero-trust gateway. CORS is not authentication and does not protect the settings or generation endpoints.

See the [Chinese deployment guide](./docker-deployment.zh-CN.md) for backup, update, and troubleshooting instructions.
