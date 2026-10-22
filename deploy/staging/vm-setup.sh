#!/usr/bin/env bash
# One-time setup of the ModDeck staging VM (Ubuntu/Debian).
# After it finishes, every merge to main deploys here through GitHub Actions.
#
#   STAGING_HOST=10.0.0.5 RUNNER_TOKEN=AAAA... ./vm-setup.sh
#   ./vm-setup.sh --no-runner     skip the GitHub Actions runner
#   ./vm-setup.sh --new-cert      replace the TLS certificate (e.g. the host changed)
#   ./vm-setup.sh --help
#
# Environment:
#   STAGING_HOST   required. IP or DNS name that phones open (https://STAGING_HOST).
#   RUNNER_TOKEN   required unless --no-runner. Registration token from GitHub:
#                  repo Settings > Actions > Runners > New self-hosted runner.
#                  It expires after 1 hour.
#   REPO_URL       default https://github.com/lnwwaveza007/ModDeck
#   DEPLOY_DIR     default /opt/moddeck (stack files, .env, certs)
#   RUNNER_DIR     default $HOME/actions-runner
#
# Run it as your normal user, not with sudo. It calls sudo where needed.
# Safe to run again: finished steps are skipped.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/lnwwaveza007/ModDeck}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/moddeck}"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner}"
RUNNER_LABEL=moddeck-staging
STAGING_HOST="${STAGING_HOST:-}"
RUNNER_TOKEN="${RUNNER_TOKEN:-}"

say() { printf '\n==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

WITH_RUNNER=1
NEW_CERT=0
for arg in "$@"; do
  case "$arg" in
    --no-runner) WITH_RUNNER=0 ;;
    --new-cert) NEW_CERT=1 ;;
    -h|--help) sed -n '2,21p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $arg (use --help)" ;;
  esac
done

[ "$(id -u)" -ne 0 ] || die "run as your normal user, not root or sudo (the script calls sudo itself)"
command -v apt-get >/dev/null || die "this script needs apt-get (Ubuntu or Debian)"
command -v sudo >/dev/null || die "sudo is required"
[ -n "$STAGING_HOST" ] || die "set STAGING_HOST to the IP or DNS name phones will open"
if [ "$WITH_RUNNER" -eq 1 ] && [ ! -f "$RUNNER_DIR/.runner" ] && [ -z "$RUNNER_TOKEN" ]; then
  die "set RUNNER_TOKEN (repo Settings > Actions > Runners > New self-hosted runner), or pass --no-runner"
fi

# --- 1. base tools ------------------------------------------------------
say "1/6 Base tools"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl git openssl tar

# --- 2. Docker Engine + Compose plugin -----------------------------------
say "2/6 Docker Engine and Compose plugin"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  echo "found $(docker --version) and $(docker compose version)"
else
  . /etc/os-release
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo systemctl enable --now docker
if ! id -nG "$USER" | grep -qw docker; then
  sudo usermod -aG docker "$USER"
  echo "added $USER to the docker group (log out and back in to use docker without sudo)"
fi

# --- 3. deploy folder ---------------------------------------------------
say "3/6 Deploy folder $DEPLOY_DIR"
sudo mkdir -p "$DEPLOY_DIR/certs" "$DEPLOY_DIR/ca"
sudo chown -R "$USER:$USER" "$DEPLOY_DIR"
chmod 700 "$DEPLOY_DIR/ca"

# --- 4. TLS certificate -------------------------------------------------
# A private CA signs the server cert. Phones install the CA once
# (http://STAGING_HOST/ca.crt) and then trust https:// and wss://.
# To use a real certificate instead, put fullchain.pem and privkey.pem in
# $DEPLOY_DIR/certs before running this script.
say "4/6 TLS certificate for $STAGING_HOST"
certs="$DEPLOY_DIR/certs"
ca="$DEPLOY_DIR/ca"
if [ -f "$certs/fullchain.pem" ] && [ "$NEW_CERT" -eq 0 ]; then
  echo "found $certs/fullchain.pem (pass --new-cert to replace it)"
else
  if [ ! -f "$ca/ca.key" ]; then
    openssl req -x509 -newkey rsa:4096 -nodes -sha256 -days 3650 \
      -keyout "$ca/ca.key" -out "$ca/ca.crt" \
      -subj "/CN=ModDeck Staging CA" \
      -addext "basicConstraints=critical,CA:TRUE" \
      -addext "keyUsage=critical,keyCertSign,cRLSign"
    chmod 600 "$ca/ca.key"
  fi

  if [[ "$STAGING_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    san="IP:$STAGING_HOST,DNS:localhost,IP:127.0.0.1"
  else
    san="DNS:$STAGING_HOST,DNS:localhost,IP:127.0.0.1"
  fi

  openssl req -newkey rsa:2048 -nodes -sha256 \
    -keyout "$certs/privkey.pem" -out "$ca/server.csr" \
    -subj "/CN=$STAGING_HOST"
  # 825 days is the longest validity iOS accepts for a server certificate.
  openssl x509 -req -sha256 -days 825 \
    -in "$ca/server.csr" -CA "$ca/ca.crt" -CAkey "$ca/ca.key" -CAcreateserial \
    -out "$ca/server.crt" \
    -extfile <(printf 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$san")
  cat "$ca/server.crt" "$ca/ca.crt" > "$certs/fullchain.pem"
  cp "$ca/ca.crt" "$certs/ca.crt"
  chmod 644 "$certs/fullchain.pem" "$certs/ca.crt"
  # The Nginx master process runs as root in the container and reads the key.
  chmod 600 "$certs/privkey.pem"
  echo "wrote $certs/fullchain.pem for $san"

  # Reload Nginx if the stack is already running.
  if sudo docker compose -f "$DEPLOY_DIR/docker-compose.yml" --env-file "$DEPLOY_DIR/.env" ps nginx 2>/dev/null | grep -q nginx; then
    sudo docker compose -f "$DEPLOY_DIR/docker-compose.yml" --env-file "$DEPLOY_DIR/.env" exec nginx nginx -s reload || true
  fi
fi

# --- 5. firewall and ports ----------------------------------------------
say "5/6 Ports 80 and 443"
if command -v ufw >/dev/null && sudo ufw status | grep -q "Status: active"; then
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
else
  echo "ufw not active, nothing to open"
fi
for port in 80 443; do
  if sudo ss -ltnp "sport = :$port" | grep -v -e docker-proxy -e '^State' | grep -q .; then
    warn "something already listens on port $port; Nginx will fail to start:"
    sudo ss -ltnp "sport = :$port" >&2
  fi
done

# --- 6. GitHub Actions self-hosted runner -------------------------------
say "6/6 GitHub Actions runner (label: $RUNNER_LABEL)"
if [ "$WITH_RUNNER" -eq 0 ]; then
  echo "skipped (--no-runner)"
elif [ -f "$RUNNER_DIR/.runner" ]; then
  echo "already configured in $RUNNER_DIR"
  (cd "$RUNNER_DIR" && sudo ./svc.sh status | grep -E "Active:" || true)
else
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "unsupported CPU: $(uname -m)" ;;
  esac
  version=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
    | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')
  [ -n "$version" ] || die "could not read the latest runner version from GitHub"
  mkdir -p "$RUNNER_DIR"
  cd "$RUNNER_DIR"
  curl -fsSL -o runner.tar.gz \
    "https://github.com/actions/runner/releases/download/v${version}/actions-runner-linux-${arch}-${version}.tar.gz"
  tar xzf runner.tar.gz
  rm runner.tar.gz
  sudo ./bin/installdependencies.sh
  ./config.sh --unattended --replace \
    --url "$REPO_URL" --token "$RUNNER_TOKEN" \
    --name "$(hostname)-staging" --labels "$RUNNER_LABEL" \
    --work _work
  sudo ./svc.sh install "$USER"
  sudo ./svc.sh start
  cd - >/dev/null
fi

# --- done ---------------------------------------------------------------
cat <<EOF

Done. Next steps:

1. On GitHub (repo Settings > Secrets and variables > Actions):
     Variable  STAGING_HOST                = $STAGING_HOST
     Secret    STAGING_POSTGRES_PASSWORD   = a long random string, for example:
               $(openssl rand -hex 24)
   Keep the password the same after the first deploy: Postgres keeps the
   password it was first started with.

2. Deploy: merge to main, or run "Deploy staging" by hand
   (Actions tab > Deploy staging > Run workflow).

3. On each phone, once: open http://$STAGING_HOST/ca.crt and install it.
     iPhone:  Settings > General > VPN & Device Management > install the
              profile, then Settings > General > About > Certificate Trust
              Settings > turn on "ModDeck Staging CA".
     Android: Settings > Security > Encryption & credentials >
              Install a certificate > CA certificate.
   Then open https://$STAGING_HOST

Check from this VM:
   curl --cacert $certs/ca.crt https://$STAGING_HOST/api/health
EOF
