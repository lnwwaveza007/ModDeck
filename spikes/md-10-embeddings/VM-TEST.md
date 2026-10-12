# MD-10: run the latency test on the target VM

The accuracy numbers in `FINDINGS.md` (slide lookup, clustering) do not depend on the machine. The latency numbers do. They were measured on a developer PC (AMD Ryzen 5 5500, 6 cores / 12 threads, 16 GB RAM, Windows 11, CPU only). A typical VM has fewer shared vCPUs, so run the latency test on the real target VM before MD-18.

## 1. Prerequisites

| Need | Check |
| --- | --- |
| Node.js 22 or newer | `node -v` |
| pnpm 10 | `corepack enable && pnpm -v` |
| Docker with Compose (easiest way to get pgvector) | `docker compose version` |
| About 3 GB of free disk and outbound access to huggingface.co | `df -h .` |

Without Docker, install Postgres 17 and pgvector natively, create a database, and set `DATABASE_URL` in `.env`.

## 2. Install

```sh
git clone <repo-url> ModDeck && cd ModDeck
git checkout feat/spike-md-10-embeddings
cp .env.example .env        # required: the scripts read ../../.env and fail if it is missing
pnpm install --filter spike-md-10-embeddings...
docker compose up -d postgres
docker compose ps            # wait until the container is healthy
```

## 3. Record the VM spec

The numbers mean nothing without it.

```sh
lscpu | grep -E "Model name|^CPU\(s\)|Thread|MHz"
free -h
nproc
```

## 4. Run the test

```sh
cd spikes/md-10-embeddings
node src/embed.mjs bge-m3-q8 e5-base     # downloads models (about 570 MB + 1.1 GB), fills pgvector
node src/latency.mjs bge-m3-q8 e5-base   # one question at a time, plus a burst of 50
node src/latency.mjs bge-m3-q8 e5-base   # run again; the first run can include warm-up
```

Optional:

- `node src/embed.mjs bge-m3` and `node src/latency.mjs bge-m3`: fp32 model, 2.2 GB download. Run it only if the VM has enough RAM.
- `node src/evaluate.mjs bge-m3-q8`: sanity check. Top-3 slide lookup should be 91.3% on any machine. If it differs, something is wrong.

## 5. Read the result

The script prints one line per model:

```
bge-m3-q8  embed p50 46 p95 99 | search ... | total ... | burst 50: 5329 ms wall, ... q/s
```

Compare with the developer PC:

| Metric | Developer PC | Target |
| --- | --- | --- |
| Embed p95, bge-m3-q8 | 99 ms | under 150 ms in total with search |
| Burst of 50, wall time | 5.3 s | under about 10 s |
| Search p50 | under 1 ms (measured inside the container) | under 5 ms |

## 6. Report the numbers

Copy `out/latency.json` and the output of step 3 into section 4.3 of `FINDINGS.md` as a new VM row. If bge-m3-q8 misses the target, see the options in section 8 of `FINDINGS.md`: use `e5-base`, batch through the queue, or ask for more vCPUs.

## Tips for a fair test

- Use the real target VM (same vCPU count and RAM as production), with nothing else heavy running.
- If the database is on another host, the search time includes that network hop. Note it in the result.
- The model download needs internet once. After that, set `HF_HUB_OFFLINE=1` to check that it runs offline.
- On Windows with Docker Desktop, the port forwarding adds about 50 ms to each query. A Linux VM does not have this, so its search time is the true one.
