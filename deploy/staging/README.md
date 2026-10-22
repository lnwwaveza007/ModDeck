# Staging deploy

Every push to `main` deploys to the staging VM ([`.github/workflows/deploy-staging.yml`](../../.github/workflows/deploy-staging.yml)):

1. **build** (GitHub-hosted runner): builds `docker/api.Dockerfile` and `docker/web.Dockerfile`, then pushes `ghcr.io/lnwwaveza007/moddeck-{api,web}:<sha>` and `:staging`.
2. **deploy** (self-hosted runner on the VM): copies this folder to `/opt/moddeck`, writes `.env` from GitHub secrets, pulls the images and runs `docker compose up --wait`.
3. **smoke check**: `GET https://127.0.0.1/api/health` through Nginx must return `"status":"ok"`, or the job fails and prints the container logs.

The deploy job runs on the VM itself because the VM is on the campus network, which GitHub-hosted runners cannot reach.

## Routes

| Path          | Goes to                                                |
| ------------- | ------------------------------------------------------ |
| `/`           | web (Next.js)                                          |
| `/api/...`    | api, prefix removed (`/api/health` → `/health`)        |
| `/socket.io/` | api, WebSocket upgrade (`wss://`)                      |
| `/ca.crt`     | staging CA certificate, over plain HTTP, for phones    |

Everything else on port 80 redirects to HTTPS.

## One-time setup

### On the VM

Get a runner registration token: repo **Settings > Actions > Runners > New self-hosted runner** (copy the value after `--token`; it expires after 1 hour). Then:

```bash
curl -fsSLO https://raw.githubusercontent.com/lnwwaveza007/ModDeck/main/deploy/staging/vm-setup.sh
chmod +x vm-setup.sh
STAGING_HOST=<vm-ip-or-name> RUNNER_TOKEN=<token> ./vm-setup.sh
```

The script installs Docker, creates `/opt/moddeck`, makes a private CA and a TLS certificate for `STAGING_HOST`, opens ports 80/443 and installs the runner as a service with the label `moddeck-staging`. It is safe to run again. `--help` lists the options.

To use a real certificate instead, put `fullchain.pem` and `privkey.pem` in `/opt/moddeck/certs/` before running the script.

### On GitHub

**Settings > Secrets and variables > Actions**:

| Kind     | Name                        | Value                                            |
| -------- | --------------------------- | ------------------------------------------------ |
| Variable | `STAGING_HOST`              | Same value as on the VM                          |
| Secret   | `STAGING_POSTGRES_PASSWORD` | Long random string. Do not change it after the first deploy: Postgres keeps the first one. |

**Settings > Actions > General > Fork pull request workflows from outside collaborators**: choose **Require approval for all outside collaborators**. The repo is public and the VM runs a self-hosted runner, so a fork PR must never run on it without review.

### On each phone (once)

Open `http://<STAGING_HOST>/ca.crt` and install it.

- **iPhone**: Settings > General > VPN & Device Management > install the profile. Then Settings > General > About > Certificate Trust Settings > turn on **ModDeck Staging CA**.
- **Android**: Settings > Security > Encryption & credentials > Install a certificate > CA certificate.

Then open `https://<STAGING_HOST>`.

## Operating

```bash
cd /opt/moddeck
docker compose ps
docker compose logs -f api
```

Roll back: re-run an older successful **Deploy staging** run from the Actions tab (it deploys that run's commit), or set `API_IMAGE` / `WEB_IMAGE` in `/opt/moddeck/.env` to an older `:<sha>` tag and run `docker compose up -d`.

The demo seed (`pnpm db:seed`) does not run on staging.
