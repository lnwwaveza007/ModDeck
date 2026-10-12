#!/usr/bin/env bash
# Full setup for the MD-10 latency test on an Ubuntu/Debian VM.
# After it finishes, the machine is ready and you run the test yourself.
#
#   ./vm-setup.sh            prerequisites + repo + dependencies + pgvector + models
#   ./vm-setup.sh --run      the same, then run the latency test too
#   ./vm-setup.sh --help
#
# Works from a clone of the repo, or as a lone copy of this file (it then
# clones the repo to ~/projects/ModDeck).
#
# Environment (all optional):
#   MODELS="bge-m3-q8 e5-base"                          models to embed and test
#   REPO_URL=https://github.com/lnwwaveza007/ModDeck.git  used only when cloning
#   REPO_DIR=$HOME/projects/ModDeck                     clone target
#   BRANCH=feat/spike-md-10-embeddings                  branch to clone
#
# Run it as your normal user, not with sudo. It calls sudo where needed.
# Safe to run again: finished steps are skipped.

set -euo pipefail

NODE_MAJOR=22
PNPM_VERSION=10.15.1
MODELS="${MODELS:-bge-m3-q8 e5-base}"
REPO_URL="${REPO_URL:-https://github.com/lnwwaveza007/ModDeck.git}"
REPO_DIR="${REPO_DIR:-$HOME/projects/ModDeck}"
BRANCH="${BRANCH:-feat/spike-md-10-embeddings}"

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

RUN=0
for arg in "$@"; do
  case "$arg" in
    --run) RUN=1 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $arg (use --run or --help)" ;;
  esac
done

[ "$(id -u)" -ne 0 ] || die "run as your normal user, not root or sudo (the script calls sudo itself)"
command -v apt-get >/dev/null || die "this script needs apt-get (Ubuntu or Debian)"
command -v sudo >/dev/null || die "sudo is required"

# --- 1. base tools ------------------------------------------------------
say "1/7 Base tools"
sudo apt-get update -y
sudo apt-get install -y curl git ca-certificates

# --- 2. Node.js ---------------------------------------------------------
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }

say "2/7 Node.js $NODE_MAJOR or newer"
if [ "$(node_major || true)" -ge "$NODE_MAJOR" ] 2>/dev/null; then
  echo "found $(node -v)"
else
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# --- 3. pnpm ------------------------------------------------------------
say "3/7 pnpm $PNPM_VERSION"
sudo corepack enable
corepack prepare "pnpm@${PNPM_VERSION}" --activate

# --- 4. Docker ----------------------------------------------------------
say "4/7 Docker and Compose"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  echo "found $(docker --version)"
else
  curl -fsSL https://get.docker.com | sudo sh
fi
if ! id -nG "$USER" | grep -qw docker; then
  sudo usermod -aG docker "$USER"
  echo "added $USER to the docker group (log out and in to use docker without sudo)"
fi
# The group change does not reach this shell, so fall back to sudo.
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then DOCKER="sudo docker"; fi

# --- 5. repo ------------------------------------------------------------
say "5/7 Repository"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../../pnpm-workspace.yaml" ] && [ -d "$SCRIPT_DIR/../../spikes/md-10-embeddings" ]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
  echo "using the repo this script is in: $REPO_ROOT"
else
  REPO_ROOT="$REPO_DIR"
  if [ ! -d "$REPO_ROOT/.git" ]; then
    mkdir -p "$(dirname "$REPO_ROOT")"
    git clone "$REPO_URL" "$REPO_ROOT" \
      || die "clone failed. For a private repo, clone it yourself and run the script from inside it."
  fi
  git -C "$REPO_ROOT" fetch origin "$BRANCH"
  git -C "$REPO_ROOT" checkout "$BRANCH"
  git -C "$REPO_ROOT" pull --ff-only origin "$BRANCH"
fi
SPIKE_DIR="$REPO_ROOT/spikes/md-10-embeddings"
[ -d "$SPIKE_DIR" ] || die "$SPIKE_DIR not found: wrong branch? (expected $BRANCH)"
cd "$REPO_ROOT"
[ -f .env ] || cp .env.example .env

# --- 6. dependencies and database ---------------------------------------
say "6/7 Dependencies and pgvector"
pnpm install --filter spike-md-10-embeddings...
$DOCKER compose up -d --wait postgres

# --- 7. embed (downloads the models, fills pgvector) --------------------
say "7/7 Embed models: $MODELS"
cd "$SPIKE_DIR"
mkdir -p out
node src/embed.mjs $MODELS

say "Record VM spec (out/vm-spec.txt)"
{
  echo "date:   $(date -u +%FT%TZ)"
  echo "node:   $(node -v)"
  echo "nproc:  $(nproc)"
  lscpu | grep -E "Model name|^CPU\(s\)|Thread|MHz" || true
  free -h
} | tee out/vm-spec.txt

FREE_GB=$(df -Pk "$REPO_ROOT" | awk 'NR==2 {printf "%d", $4/1024/1024}')
echo "disk: ${FREE_GB} GB free"

if [ "$RUN" -eq 1 ]; then
  say "Latency, run 1 of 2 (warm-up)"
  node src/latency.mjs $MODELS
  say "Latency, run 2 of 2 (use this one)"
  node src/latency.mjs $MODELS | tee out/vm-latency.log
  say "Done. Results: $SPIKE_DIR/out/latency.json and out/vm-spec.txt"
  exit 0
fi

cat <<MSG

==> Setup finished. Run the test yourself:

  cd $SPIKE_DIR
  node src/latency.mjs $MODELS      # run 1: warm-up
  node src/latency.mjs $MODELS      # run 2: use this one
  node src/evaluate.mjs bge-m3-q8   # optional check: top-3 lookup should be 91.3%

Results: out/latency.json and out/vm-spec.txt

Try your own questions in the browser (the server listens on localhost only):

  node src/build-demo.mjs           # build the page from this VM's vectors
  node demo/server.mjs              # keep it running

  # on your own computer, open a tunnel, then browse http://localhost:4173
  ssh -L 4173:localhost:4173 $USER@<vm-address>
MSG
