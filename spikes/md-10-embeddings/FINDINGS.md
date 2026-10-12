# MD-10 Findings: Embeddings and pgvector clustering

**Verdict: pass. Slide lookup and grouping both work. Gemini is clearly more accurate than the self-hosted models, so the product supports both: the user picks our service or their own Gemini key.**

- **Slide lookup.** The right slide is in the top 3 for **99.0%** of questions with `gemini-embedding-2` (97.1% with `gemini-embedding-001`), against 91.3% for self-hosted bge-m3 (8-bit). Top-1: 93.3%, 89.4% and 77.9%.
- **Grouping.** At the safest threshold (no wrong merges), Gemini merges 38% of duplicate pairs and bge-m3 (8-bit) merges 23%. A threshold alone still leaves many duplicate cards with every model, so the instructor-confirm band stays.
- **Speed.** Gemini takes about 470 ms per question from this PC, and 50 questions at the same moment take about 3 s. Self-hosted bge-m3 (8-bit) takes about 110 ms per question on the 4 vCPU VM. This is fine for this feature, because it runs in the background (see section 1).
- **Decision (13 Oct).** The product supports both ways and the user chooses: **our service** (self-hosted bge-m3, 8-bit, text stays at KMUTT, no per-question fee) or **their own Gemini key** (best accuracy, text goes to Google under that key, about $0.004 per 1,000 questions, paid by the user). See sections 5 and 8.

One part is still open: the questions are a **draft set written by the team**, not real student questions (section 7).

## 1. Goal and acceptance criteria

- [~] Dataset of ~100 labelled real-style student questions (Thai and English mixed). 113 are labelled, but all of them are `source: "draft"`.
- [x] At least 2 embedding models compared. 4 self-hosted configurations and 2 Gemini models are compared.
- [x] Metrics recorded: clustering precision, slide lookup top-3 accuracy, latency per question
- [x] Decision on data handling: support both, and the user chooses (section 5)
- [x] Findings note written

The spike rule's **< 150 ms** target is for the live real-time features (polls, word cloud, the live question list). The team confirmed that AI grouping and slide lookup may take longer, because they run in the background and fill in the card when ready. This note keeps 150 ms as a reference point and treats up to about 1 s per question, and a few seconds for a burst, as acceptable. This is a working assumption: confirm the exact limit in MD-18.

## 2. Setup

| Item | Value |
| --- | --- |
| Machine | AMD Ryzen 5 5500 (6 cores / 12 threads), 16 GB RAM, Windows 11. CPU only, no GPU used. |
| Runtime | Node.js 22.13.0, `@huggingface/transformers` 4.3.1 (ONNX Runtime), `pg` 8.23.1 |
| Database | `pgvector/pgvector:pg17` from `docker-compose.yml`, pgvector 0.8.7, HNSW index with `vector_cosine_ops` |
| Slides | MD-14 `data/slides-text.json`: **Vue Chapter 1** (20 slides, English with some Thai) and **INT319 W07 Corporate Strategy** (22 slides, mostly Thai). One empty slide was dropped, so 41 slides remain. |
| Questions | `data/questions.json`: 113 questions in 49 labelled groups. Vue: 61 (19 English, 37 mixed, 5 Thai). W07: 52 (18 English, 22 mixed, 12 Thai). 104 have an answer slide, and 9 have no answer slide (for example "when is the midterm"). |

Models:

| Name | Model | Size | Dims | Notes |
| --- | --- | --- | --- | --- |
| e5-small | `Xenova/multilingual-e5-small` | 118M | 384 | `query:` / `passage:` prefixes |
| e5-base | `Xenova/multilingual-e5-base` | 278M | 768 | same prefixes |
| bge-m3 | `Xenova/bge-m3` fp32 | 568M | 1024 | CLS pooling, about 2.2 GB download |
| bge-m3-q8 | `Xenova/bge-m3` 8-bit | 568M | 1024 | about 570 MB |
| gemini-2 | `gemini-embedding-2` (API) | — | 768 | task prefixes in the text |
| gemini-001 | `gemini-embedding-001` (API) | — | 768 | `taskType` RETRIEVAL_QUERY / RETRIEVAL_DOCUMENT |

## 3. Method

1. `src/data.mjs` cleans the MD-14 text. It joins diagram labels that come out one letter per line (`O\nr\ng\na…`), drops the lecturer footer that repeats on each Vue slide, and squashes whitespace. Each slide is embedded as "deck title + slide text".
2. `src/embed.mjs` embeds the slides and questions, saves the vectors to `out/`, and loads them into a pair of tables per model (`slide_<model>`, `question_<model>`), with an HNSW index on each.
3. `src/evaluate.mjs`:
   - **Slide lookup.** For each question with an answer slide, a pgvector query gets the top-3 slides of that question's deck (`ORDER BY embedding <=> $1 LIMIT 3`). A hit means that any of the labelled slides is in the top 3. The script also records top-1 and MRR@3.
   - **Clustering**, done online as in class. Questions arrive one at a time, in 20 random orders per deck. *single*: a new question joins the cluster of its most similar earlier question if the cosine similarity is ≥ t. *centroid*: it joins the most similar cluster mean instead. Scores are pairwise precision and recall against the labelled groups, plus "mixed" (predicted clusters that hold 2 or more labelled groups, that is, wrong cards).
   - **Threshold tuning.** The threshold with the best F0.5 is used, because a wrong merge hides a question and a missed merge only shows a duplicate card. To avoid tuning on the test data, t is tuned on one deck and tested on the other, both ways ("held-out"). "Oracle" means the best t on both decks.
4. `src/latency.mjs` times each question one at a time: embed 1 question, get the top-3 slides, then find the nearest earlier question. It also runs a burst of 50 questions sent at the same moment.

Questions use the query side only, for both lookup and clustering, because the product embeds each question once.

Run it:

```sh
docker compose up -d postgres
cd spikes/md-10-embeddings
node src/embed.mjs e5-small e5-base bge-m3 bge-m3-q8     # add gemini-2 gemini-001 when GEMINI_API_KEY is in .env
node src/evaluate.mjs e5-small e5-base bge-m3 bge-m3-q8  # writes out/results.json
node src/latency.mjs e5-small e5-base bge-m3 bge-m3-q8   # writes out/latency.json
```

## 4. Results

### 4.1 Slide lookup (104 questions with an answer slide)

| Model | Top-1 | **Top-3** | MRR@3 | Top-3 Thai (14) | Top-3 mixed (57) | Top-3 English (33) | Top-1 sim, answerable / no answer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| e5-small | 66.3% | 85.6% | 0.748 | 78.6% | 87.7% | 84.8% | 0.846 / 0.808 |
| e5-base | 64.4% | **92.3%** | 0.768 | 78.6% | 96.5% | 90.9% | 0.822 / 0.783 |
| bge-m3 | **77.9%** | 91.3% | **0.843** | **92.9%** | 91.2% | 90.9% | 0.571 / 0.411 |
| bge-m3-q8 | 77.9% | 91.3% | 0.840 | 85.7% | 93.0% | 90.9% | 0.559 / 0.395 |

- All the larger models are above 90% top-3. bge-m3 is clearly better at top-1 (78% against 64–66%), and best on Thai-only questions.
- **bge-m3 can tell "no answer slide" apart from the rest.** The mean top-1 similarity is 0.57 for answerable questions and 0.41 for the others. With e5, the gap is only 0.04, so a minimum score cannot hide bad suggestions. With bge-m3, a minimum of about 0.45 can hide the "jump to slide" button for off-topic questions.
- The misses are mostly on W07 diagram slides, where the text is a set of labels, and on questions about a slide's footnote. For example, "is the Toyota data real?" refers to the footnote on slides 17–18.
- The pgvector results are the same as a brute-force check in JS.

### 4.2 Clustering (pairwise, online, single-link)

| Model | Held-out: test Vue (t) | Held-out: test W07 (t) | Oracle t | Oracle precision | Oracle recall | Cross-language recall |
| --- | --- | --- | --- | --- | --- | --- |
| e5-small | P 77% R 17% (0.90) | P 35% R 13% (0.90) | 0.90 | 55% | 15% | 11% |
| e5-base | P 30% R 35% (0.86) | P 31% R 7% (0.89) | 0.87 | 43% | 24% | 20% |
| **bge-m3** | **P 83% R 33% (0.70)** | **P 91% R 32% (0.71)** | 0.71 | **93%** | 31% | 38% |
| bge-m3-q8 | P 92% R 19% (0.71) | P 65% R 37% (0.67) | 0.67 | 76% | 40% | 49% |

Threshold sweep for bge-m3 (both decks, 113 questions, 49 true groups):

| t | Precision | Recall | Cards shown | Wrong (mixed) cards |
| --- | --- | --- | --- | --- |
| 0.60 | 30% | 58% | 52 | 10.5 |
| 0.65 | 47% | 53% | 63 | 6.7 |
| 0.70 | 86% | 33% | 84 | 2.3 |
| 0.75 | 100% | 20% | 97 | 0 |
| 0.80 | 100% | 13% | 101 | 0 |

- **e5 does not work for clustering.** All its similarities fall between 0.75 and 0.95, so a threshold that keeps precision merges almost nothing. On e5-base, a threshold tuned on one deck merges unrelated questions on the other deck (30% precision).
- **bge-m3 has a usable threshold, and the held-out threshold matches the oracle (0.70–0.71).** Tuning on one course carries over to another course.
- The weak point is recall. Paraphrases that share few words ("Can the project name have capital letters?" and "Does it have to be kebab-case?") and English–Thai pairs are often under 0.70. At t = 0.70, the instructor sees 84 cards for 49 real topics, and about 2 of these cards mix topics.
- The centroid mode is no better than single-link (oracle bge-m3: P 85%, R 31%). Single-link maps to one pgvector query (nearest earlier question), so it is simpler.
- The 8-bit model is less stable: its best t differs by deck (0.67 against 0.71). Its lookup is the same as fp32.

### 4.3 Latency per question (one question at a time, CPU)

The table below was measured on a developer PC (Ryzen 5 5500, 12 threads, 16 GB). A 4-vCPU test VM is in section 4.3.1.

| Model | Embed p50 | Embed p95 | Search (in DB) | Per question p50 / p95 | Burst of 50 | Throughput |
| --- | --- | --- | --- | --- | --- | --- |
| e5-small | 16 ms | 29 ms | < 1 ms | ~17 / ~30 ms | 0.9 s | 57 q/s |
| e5-base | 43 ms | 143 ms | < 1 ms | ~45 / ~145 ms | 4.1 s | 12 q/s |
| bge-m3 | 110 ms | 248 ms | < 1 ms | ~111 / ~250 ms | 8.5 s | 6 q/s |
| **bge-m3-q8** | 46 ms | 99 ms | < 1 ms | **~47 / ~100 ms** | 5.3 s | 9 q/s |

- **Search time is not a concern.** `EXPLAIN ANALYZE` shows 0.5–0.8 ms per query. With 20–40 rows per deck, Postgres uses a sequential scan, not HNSW, and that is correct at this size.
- The raw script measured 50 ms per query for 768-dim and 1024-dim vectors (5 ms for 384 dims). This comes from **Docker Desktop port forwarding on Windows**. The same query run inside the container takes 0.5–1.7 ms. In production, the API and DB share a Docker network, so the table above uses the in-DB time.
- bge-m3-q8 meets < 150 ms at p95 for a single question. bge-m3 fp32 does not (248 ms p95).
- **Bursts queue up.** One ONNX session handles one request at a time. With 50 questions at the same moment, the last one waits about 5 s on bge-m3-q8. Batching helps: batches of 8 ran at about 28 questions/s (113 questions in 4.1 s). This is fine for clustering, which does not need to finish in 150 ms, but it needs a queue (see section 8).
- Model load at start-up: 4–13 s. Load the model once per worker, not per request.

### 4.3.1 Test VM (4 vCPU, no AVX2)

Spec: QEMU Virtual CPU version 2.5+, 4 vCPU (1 thread per core), 7.2 GB RAM, Node 22.22.1, pgvector in Docker on the same host. `grep -m1 -o -w -E 'avx2|avx512f' /proc/cpuinfo` printed nothing, so the VM hides AVX2 and AVX-512 from the guest. ONNX Runtime has to use slower kernels. Questions were sent one at a time, with nothing else running.

| Model | Run | Embed p50 / p95 | Search p50 / p95 | Per question p50 / p95 | Burst of 50 | Throughput |
| --- | --- | --- | --- | --- | --- | --- |
| bge-m3-q8 | 1 (warm-up) | 106 / 196 ms | 3.7 / 11.0 ms | 110 / 199 ms | 5.5 s | 9.0 q/s |
| bge-m3-q8 | 2 | 106 / 144 ms | 3.6 / 6.5 ms | **111 / 148 ms** | 5.8 s | 8.7 q/s |
| e5-base | 1 (warm-up) | 49 / 134 ms | 3.4 / 9.2 ms | 55 / 141 ms | 2.8 s | 17.9 q/s |
| e5-base | 2 | 49 / 67 ms | 3.5 / 6.7 ms | **53 / 71 ms** | 2.6 s | 19.5 q/s |

- bge-m3-q8 is **at the limit**: p95 is 148 ms on run 2 and 199 ms on run 1. It meets the 150 ms target only with nothing else running. The API, Redis, WebSocket traffic and Postgres will share these 4 vCPUs in production.
- e5-base has room (p95 71 ms) but is weaker at clustering (section 4.2).
- Batch embedding (import and queue) was 2 to 3 times slower than on the developer PC: 41 slides in 59.9 s for bge-m3-q8 (about 1.5 s per slide), 113 questions in 11.0 s.
- Search is a few ms here because the script reaches the database through Docker port forwarding. It is not a concern.
- The accuracy rerun on the VM gave top-1 78.8% and top-3 92.3% for bge-m3-q8 (PC: 77.9% and 91.3%). The clustering oracle threshold was 0.69 with P 80% and R 33% (PC: 0.67, P 76%, R 40%). The 8-bit model gives slightly different vectors on different CPUs (mean cosine 0.986 between machines), so expect about one question of difference. The conclusions do not change.
- Untested: AVX2 passthrough (VM CPU type `host` or `host-passthrough`), more vCPUs, and a test under load. AVX2 is the first thing to change, because it needs no extra hardware.

### 4.4 Cost per 1,000 questions

Tokens measured with each model's tokenizer: **13–16 tokens per question** (bge-m3 / e5), and about 145 tokens per slide.

| Option | 1,000 questions | One 50-slide deck | Notes |
| --- | --- | --- | --- |
| Self-hosted bge-m3-q8 | ~0 extra | ~0 extra | Uses CPU on the existing API server. RAM per worker not measured. 25 s to embed 41 slides. |
| `gemini-embedding-2` paid tier ($0.20 / 1M tokens) | ~$0.004 | ~$0.0016 | Measured with the API token counter: 18 tokens per question and 163 per slide. |
| `gemini-embedding-2` free tier | $0 | $0 | Rate limits apply. **Google uses the data to improve its products.** |

Cost does not decide between the options, because both are close to free. Privacy, latency and offline operation decide.

### 4.5 Gemini API results

Same 113 questions and 41 slides, same scripts. Free-tier key, called from the developer PC.

| Model | Top-1 | Top-3 | Top-3 Thai (14) | Top-3 mixed (57) | Top-3 English (33) | Top-1 sim, answerable / no answer |
| --- | --- | --- | --- | --- | --- | --- |
| gemini-embedding-2 | **93.3%** | **99.0%** | 92.9% | **100%** | **100%** | 0.716 / 0.625 |
| gemini-embedding-001 | 89.4% | 97.1% | **100%** | 96.5% | 97.0% | 0.697 / 0.618 |
| bge-m3-q8 (for comparison) | 77.9% | 91.3% | 85.7% | 93.0% | 90.9% | 0.559 / 0.395 |

Grouping (single-link, online, as in section 4.2):

| Model | Safest threshold (precision 100%) | Recall there | Cards for 49 real topics | Held-out precision / recall |
| --- | --- | --- | --- | --- |
| gemini-embedding-2 | 0.80 | **38%** | 84 | 100% / 35% (Vue), 54% / 55% (W07) |
| gemini-embedding-001 | 0.81 | 31% | 87 | 95% / 32% (Vue), 82% / 42% (W07) |
| bge-m3-q8 | 0.72 | 23% | 94 | see section 4.2 |

Speed from this PC, one question at a time, with 4 requests in flight for the burst:

| Model | Embed p50 / p95 | Slowest single call | Burst of 50 |
| --- | --- | --- | --- |
| gemini-embedding-2 | 470 / 524 ms | 2.6 s | 3.0 s (16.6 q/s) |
| gemini-embedding-001 | 403 / 434 ms | 14.8 s | 3.2 s (15.7 q/s) |

- **Gemini is more accurate on every measure except the no-answer gap.** It finds the right slide in the top 3 for all but 1 of 104 questions (`gemini-embedding-2`). It also merges more duplicates at the same precision, and it works well on English–Thai pairs.
- **The no-answer gap is smaller.** Answerable and off-topic questions score 0.72 and 0.63 with Gemini, a gap of 0.09. With bge-m3 it is 0.56 and 0.40, a gap of 0.16. A "hide the suggestion below X" floor separates off-topic questions less cleanly with Gemini, so it needs a floor tuned for it.
- **The best threshold is not stable across decks with `gemini-embedding-2`** (0.80 on one deck, 0.76 on the other, with precision dropping to 54%). `gemini-embedding-001` is steadier (0.79 and 0.78). Use a high auto-merge threshold and the confirm band, not a single cut.
- **Each model has its own threshold range.** Gemini scores sit higher (0.6 to 0.9). Do not reuse the bge-m3 merge rules (0.75 and 0.62). For `gemini-embedding-2`, auto-merge at 0.80 or more, and suggest between about 0.74 and 0.80.
- **API tail risk.** One `gemini-embedding-001` call took 14.8 s, probably a retry after a rate-limit response. The page must never wait on the embedding: post the question first and add the grouping when it is ready.
- The "search" column printed by the latency script on this PC is dominated by Docker Desktop port forwarding and is not meaningful. It is under 1 ms in the database (section 4.3).

## 5. Data privacy: what leaves KMUTT with an external API

If ModDeck calls the Gemini API (or any hosted embedding API):

- **Every question text is sent to Google**, in real time, with an API key that identifies the ModDeck project. The question text can contain names, student IDs, course problems, or personal remarks. "Anonymous" questions are anonymous to the instructor, not to the API provider.
- **The text of every imported slide deck is sent to Google** at import time. This is instructors' teaching material, and some of it may not be public (exam hints, case data).
- No student account data is sent, unless the student types it into a question.
- **On the free tier, Google states that the data is "used to improve our products"**. On the paid tier, it is not used to improve the products, but it still leaves KMUTT and is processed on Google servers, likely outside Thailand.
- PDPA (Thailand): question text can be personal data. Sending it abroad to a processor needs a legal basis, a data processing agreement, and a notice to students. The project would need KMUTT approval for this.

With a self-hosted model, **nothing leaves the KMUTT server**. Slides, questions and vectors stay in our PostgreSQL. The only download is the open model weights, once (bge-m3: MIT licence; multilingual-e5: MIT).

**Decision (13 Oct): support both ways, and the user chooses.** Section 4.5 shows Gemini is clearly more accurate (99% against 91% for the right slide in the top 3), and the self-hosted model keeps all text inside KMUTT. Each user picks one:

| | Our service (bge-m3, 8-bit) | Their own Gemini key (`gemini-embedding-2`) |
| --- | --- | --- |
| Accuracy | 8 points lower on slide lookup, 15 points lower recall at the same precision | best |
| Privacy | nothing leaves KMUTT | question and slide text go to Google under the user's key |
| Cost per 1,000 questions | no per-question fee | about $0.004, paid by the user |
| One 50-slide deck, once | no fee, about 75 s of CPU on the 4 vCPU VM | about $0.0016 |
| 10,000 questions (100 sessions of 100) | server cost only | about $0.04 |
| We must provide | enough CPU (about 9 questions per second on 4 vCPU) and a queue | safe storage for the key |

- The free Gemini tier costs $0, but Google may use that data to improve its products, and it has rate limits. It is the user's own account and choice, so the app should warn before they paste a free-tier key.
- The server cost of our service is not priced. The spike measured throughput, not monthly cost.
- Student question text can contain personal data. When a user picks their own Gemini key, show a notice that the text goes to Google. The wording is still to be defined.

## 6. What was sent to Google in this run

The Gemini run used a free-tier key, so Google may use that data to improve its products. It sent:

- the text of the **41 slides** from the two lecture decks (Vue Chapter 1 and INT319 W07), taken from the MD-14 import;
- the **113 draft questions** written by the team (no real student questions).

The lecturer's email address and phone number on the title slide were removed before sending (`redact()` in `src/models.mjs`). Slide text was otherwise sent as it is. Rotate the API key after the spike, and do not send real course material or student questions on a free-tier key again.

To rerun: add `GEMINI_API_KEY=...` to the repo `.env` (git ignores it), then run `node src/embed.mjs gemini-2 gemini-001`, `node src/evaluate.mjs bge-m3-q8 gemini-2 gemini-001` and `node src/latency.mjs gemini-2 gemini-001`.

## 7. Dataset limits

- **All 113 questions are drafts written by the team in student style. None was collected from real students yet.** They include the patterns we expect: polite particles (ครับ/คะ), slang (มั้ย, อะ), Thai with English terms, English-only questions, near-duplicates that belong to different groups, and off-topic questions. But real questions will be shorter, have more typos, and use more slang. **The numbers in section 4 are a first estimate and are probably optimistic.**
- The labels come from a single labeller. Group boundaries (for example, "Reactivity" and "Two core features" are kept apart) are a judgment call. Recall depends a lot on these boundaries.
- Before MD-18: collect at least 50 real questions (TAs, friends, or one real class), with `source: "real"`. Have a second person label them, then rerun the 3 commands. Report draft-only and real-only numbers separately.

## 8. Recommendation for the ADR (MD-18)

- **Models: both, behind one embedding function** (section 5). The user picks per session or deck: our service (`bge-m3`, 8-bit ONNX, in a Node worker with transformers.js, next to the API) or their own Gemini key (`gemini-embedding-2`).
  - Latency does not decide it: this feature may take about a second (section 1). A Gemini call takes about 0.5 s and the self-hosted model about 0.1 s.
  - **Store the model name with each vector.** Vectors from different models cannot be compared. One session or deck uses one model, and switching means re-embedding that deck and its questions once.
  - **Keep the user's key safe:** encrypt it at rest, never send it to the browser, never write it to logs.
  - Keep fp32 bge-m3 as an option if a faster CPU is available: it is more stable on clustering and has better Thai top-3.
- **Storage:** `vector(1024)` columns, cosine distance, filtered by `session_id` / `deck_id`. Per-deck tables are small (20–60 slides, hundreds of questions), so exact scan is fast. An HNSW index helps only for cross-deck or cross-course search. If HNSW is used with a filter, enable the pgvector 0.8 iterative scan (`hnsw.iterative_scan`), so that filtered queries do not return too few rows.
- **Clustering design (important):** do not use a threshold alone. Use two bands:
  - sim ≥ the auto-merge value: merge automatically (100% precision on this set). bge-m3 (8-bit): **0.75**. `gemini-embedding-2`: **0.80**;
  - between the suggest value and that: show "possibly the same as …" on the instructor card, with one-tap merge (or an LLM yes/no check, if a later spike allows it). The suggest value is **0.62** for bge-m3 (8-bit) and about **0.74** for `gemini-embedding-2`;
  - below that: a new card.

  Tune the bands again on real questions. The thresholds belong to one model, so tune them again if the model changes.
- **Slide lookup:** show the top 3 slides, and hide the suggestion when the top-1 similarity is under a floor: about 0.45 for bge-m3 (8-bit). Gemini separates off-topic questions less (section 4.5), so tune its floor on real questions.
- **Pipeline:** the question is posted first, and the grouping and slide suggestion are added to the card when ready, so a slow or failed embedding never blocks the live question list. Put questions on a Redis queue. A worker embeds them in micro-batches (for example, up to 8 questions or 50 ms), runs the nearest-question and top-3-slide queries, and publishes the result. Slide embedding runs in the MD-14 import job (about 0.5 s per slide on CPU).
- **Text preparation:** keep the MD-14 Thai repair, join vertical letters, and remove repeated footers. Diagram-heavy slides embed badly. Speaker notes or OCR (MD-14) could help there.

## 9. Open questions

- Real-question numbers (section 7).
- Wording of the notice shown when a user adds their own Gemini key, and whether KMUTT needs to review it.
- Monthly cost of the server for our service: not priced yet.
- Gemini behaviour under load: rate limits on the paid tier, and the 14.8 s slowest call seen once.
- Does a short LLM check in the middle band (0.62–0.75) fix recall at an acceptable latency and cost? This is the next spike if the two-band design is not enough.
- Can a small fine-tune or a Thai-specific model (for example WangchanBERTa-based sentence models) beat bge-m3 on mixed Thai/English? Not tested.
- Server sizing: the target server's CPU is unknown. Section 4.3.1 has a first run on a 4-vCPU VM (bge-m3-q8 p95 148 to 199 ms). Rerun with AVX2 enabled, and under load (API + Redis + sockets), with [VM-TEST.md](VM-TEST.md).
