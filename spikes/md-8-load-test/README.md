# MD-8: WebSocket load test (runbook)

Load test of the MD-2 Socket.IO + Redis server with simulated clients. No UI is involved: Artillery's Socket.IO engine speaks the protocol in place of browsers. Results and analysis are in [FINDINGS.md](FINDINGS.md).

| Path | What it is |
| --- | --- |
| `scenarios/ramp.yml` | Scenario 1: ramp to 300 connections in one room over 60 s, hold 5 min, light vote probe (~1 vote/s) |
| `scenarios/burst.yml` | Scenario 2: 300 clients in one room each send one vote inside the same 1 s window |
| `scenarios/sustained.yml` | Scenario 3: Q&A traffic, 3 rooms x 100 clients, 5 questions/s per room for 10 min |
| `scenarios/processor.cjs` | Artillery processor: joins rooms, sends, times every delivery, counts drops |
| `run.mjs` | Runs one scenario, samples server `/metrics` each second, writes `results/<label>/summary.json` |
| `report.mjs` | Builds `results/RESULTS.md` and `results/charts/*.svg` from all runs |
| `monitoring/` | Prometheus + Grafana (Docker Compose) with the provisioned "MD-8 WebSocket load test" dashboard |
| `nginx/` | Stretch: Nginx in front of 2 api instances |

## What is measured

- **Latency**: time from a client sending a message to each client in the room receiving the broadcast. All simulated clients run on the load generator, so sender and receiver share one clock and no clock sync is needed. The server echoes `clientMsgId` and `sentAt` for this.
- **Dropped messages**: for each room, `sent x clients joined - broadcasts received`. Socket.IO reconnection is turned off, so a dropped connection shows up as missing messages, not a silent rejoin.
- **Server**: CPU, RSS, heap, event-loop lag (p50/p99/max per scrape), connections, messages/s, fan-out packets/s, handler time, and Redis CPU, memory and ops/s from INFO. All are served on `GET /metrics`.
- **Pass** = delivery p95 < 150 ms and 0 dropped messages.

## Machines

The load generator must run on a different machine from the server stack. Record both specs in FINDINGS.md:

```sh
# Linux
lscpu | grep -E "Model name|^CPU\(s\)"; free -h; uname -a
# Windows (PowerShell)
Get-CimInstance Win32_Processor | Select Name,NumberOfCores,NumberOfLogicalProcessors
[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1)
```

`run.mjs` also records the load generator's CPU, RAM, OS and Node version in each `results/<label>/config.json`.

Both machines need to be on the same wired LAN if possible. Wi-Fi adds jitter that shows up in p99.

## 1. Server machine

```sh
git clone <repo> ModDeck && cd ModDeck && git checkout feat/spike-MD-8-load-test
corepack enable && pnpm install --filter spike-md-2-websocket-pubsub...
docker compose up -d redis                       # or a native Redis on :6379
cd spikes/md-2-websocket-pubsub && pnpm build

# Linux: raise the open-file limit before starting (each client is one socket)
ulimit -n 65535

INSTANCE_NAME=api-a API_PORT=4000 node dist/main > api-a.log 2>&1 &
curl localhost:4000/health && curl -s localhost:4000/metrics | grep moddeck_ws

# Monitoring (Prometheus :9090, Grafana :3001, anonymous viewer access)
docker compose -f ../md-8-load-test/monitoring/docker-compose.yml up -d
```

Open `http://<server>:3001` → dashboard **ModDeck / MD-8 WebSocket load test**. Set the time range to cover the run before taking screenshots for the findings note.

Open port 4000 (and 4001/8080 for the stretch run) in the server firewall.

`VOTE_BROADCAST_INTERVAL_MS` controls vote coalescing (default `50`). Set it to `0` to reproduce the baseline behaviour (one broadcast per vote).

## 2. Load-generator machine

```sh
git clone <repo> ModDeck && cd ModDeck && git checkout feat/spike-MD-8-load-test
corepack enable && pnpm install --filter spike-md-8-load-test...
cd spikes/md-8-load-test
ulimit -n 65535   # Linux/macOS

S=http://<server-ip>:4000
for i in 1 2 3; do node run.mjs --scenario burst     --target $S --label fixed-burst-$i;     done
for i in 1 2 3; do node run.mjs --scenario ramp      --target $S --label fixed-ramp-$i;      done
for i in 1 2 3; do node run.mjs --scenario sustained --target $S --label fixed-sustained-$i; done
node report.mjs
```

Each run prints one line such as `PASS | delivery p50 … p95 … p99 … | dropped 0/90000 | …` and any warnings (late joins, load-generator CPU above 85%). A run with warnings is not valid evidence. Fix the cause and rerun.

Run times: burst ~1 min, ramp ~6.5 min, sustained ~11 min.

Each run writes `results/<label>/`. Only `summary.json`, `config.json`, `schedule.json` and `raw-*.json` are committed. `samples.jsonl` and the Artillery report and log stay local (see `.gitignore`). Run `node report.mjs` before committing so `results/charts/` and `results/RESULTS.md` are up to date.

Useful flags: `--clients`, `--rooms`, `--connect-s`, `--hold-s`, `--duration-s`, `--rate` (messages/s per room), `--window-ms` (burst window), `--workers` (Artillery worker count), `--note`.

## 2b. Fallback: load generator on the same VM, CPUs split

Use this only when no second machine can reach the server without a VPN; a VPN distorts the latency (see FINDINGS.md). It doesn't meet the "different machine" criterion. It does remove CPU interference, by giving the server side and the load generator their own cores (here 4 vCPUs split 2 + 2):

```sh
# server side on vCPU 0-1
sudo docker update --cpuset-cpus 0-1 moddeck-redis-1
INSTANCE_NAME=api-a API_PORT=4000 nohup taskset -c 0,1 node dist/main > ~/api-a.log 2>&1 &

# load generator on vCPU 2-3; MD8_LOADGEN_CPUS makes the CPU warning measure only those cores
cd spikes/md-8-load-test
MD8_LOADGEN_CPUS=2,3 taskset -c 2,3 node run.mjs --scenario burst --target http://localhost:4000 --label vmpin-burst-1
```

## 3. Stretch: 2 instances behind Nginx, 1,000+ connections

On the server, start a second instance and Nginx:

```sh
INSTANCE_NAME=api-b API_PORT=4001 node dist/main > api-b.log 2>&1 &
docker compose -f ../md-8-load-test/nginx/docker-compose.yml up -d
```

From the load generator, connect through Nginx and scrape both instances directly:

```sh
M=http://<server-ip>:4000/metrics,http://<server-ip>:4001/metrics
node run.mjs --scenario burst     --target http://<server-ip>:8080 --metrics $M --clients 1200 --rooms 4 --label stretch-burst-1
node run.mjs --scenario sustained --target http://<server-ip>:8080 --metrics $M --clients 1200 --rooms 6 --duration-s 300 --label stretch-sustained-1
```

`least_conn` spreads the WebSocket connections across both instances. Broadcasts cross instances through the Redis adapter. Check the "Open WebSocket connections" panel to confirm both instances carry load.

Without Nginx, `--target http://<ip>:4000,http://<ip>:4001` runs one Artillery process per instance and splits the clients evenly across them.
