# ModDeck — Phase 2 Tickets: Feasibility, UX/UI Flow, Prototype

- **Capacity:** 3 sprints × 17 SP = 51 SP (1 sprint = 1 week)
- **Tracks:**
  - **Spike** — technical feasibility tests
  - **UX** — user flows and design
  - **Proto** — clickable prototype and working end-to-end slice
- **Spike rule:** Every spike is timeboxed. Its output is a short findings note with a pass/fail verdict against the proposal targets (300 concurrent users per session, latency < 150 ms). Spike code is throwaway unless MD-18 says otherwise.
- **SP values are a first guess.** Re-estimate each ticket from its steps during sprint planning.

## Summary

| Sprint | Goal | Tickets | SP |
|---|---|---|---|
| 1 | Foundation and flows | MD-1, MD-2, MD-4, MD-5, MD-6, MD-7, MD-14 | 17 |
| 2 | Load and AI spikes, design system | MD-8, MD-9, MD-10, MD-11, MD-12 | 17 |
| 3 | Resilience, prototype, decision | MD-3, MD-13, MD-15, MD-16, MD-17, MD-18, MD-19 | 17 |

## Jira mapping (project MOD, backlog ranked in this order)

Epics: MOD-2 Feasibility Spikes · MOD-3 UX/UI Flow and Design · MOD-4 Prototype and Foundation

| Rank | Plan ID | Jira | Sprint | Priority | SP |
|---|---|---|---|---|---|
| 1 | MD-1 | MOD-5 | 1 | Highest | 3 |
| 2 | MD-2 | MOD-6 | 1 | Highest | 3 |
| 3 | MD-7 | MOD-7 | 1 | High | 1 |
| 4 | MD-14 | MOD-8 | 1 | High | 2 |
| 5 | MD-5 | MOD-9 | 1 | High | 3 |
| 6 | MD-6 | MOD-10 | 1 | High | 3 |
| 7 | MD-4 | MOD-11 | 1 | Medium | 2 |
| 8 | MD-10 | MOD-12 | 2 | Highest | 5 |
| 9 | MD-8 | MOD-13 | 2 | Highest | 5 |
| 10 | MD-9 | MOD-14 | 2 | High | 3 |
| 11 | MD-12 | MOD-15 | 2 | High | 2 |
| 12 | MD-11 | MOD-16 | 2 | High | 2 |
| 13 | MD-15 | MOD-17 | 3 | Highest | 3 |
| 14 | MD-18 | MOD-18 | 3 | Highest | 2 |
| 15 | MD-3 | MOD-19 | 3 | High | 2 |
| 16 | MD-13 | MOD-20 | 3 | High | 3 |
| 17 | MD-16 | MOD-21 | 3 | High | 3 |
| 18 | MD-17 | MOD-22 | 3 | Medium | 3 |
| 19 | MD-19 | MOD-23 | 3 | Low | 1 |

Hard blockers are Jira "Blocks" links. Soft blockers are "Relates" links.

## Blockers

### Legend

- **Blocked by (hard):** Cannot start until the blocking ticket is done.
- **Blocked by (soft):** Can start with a mock or placeholder. Must update when the blocking ticket is done.
- **External blocker:** Depends on people or resources outside the team. Act early.

### Blocker table

| Ticket | Sprint | Blocked by (hard) | Blocked by (soft) | Blocks | External blocker |
|---|---|---|---|---|---|
| MD-1 | 1 | — | — | MD-2, MD-17 | — |
| MD-2 | 1 | MD-1 | — | MD-8, MD-9, MD-13, MD-17 | — |
| MD-3 | 3 | — | MD-2 | MD-15 (soft) | Test phones, projector room |
| MD-4 | 1 | — | — | MD-5 (soft) | — |
| MD-5 | 1 | — | MD-4, MD-7 | MD-6 | — |
| MD-6 | 1 | MD-5 | — | MD-15 | — |
| MD-7 | 1 | — | — | MD-5 (soft) | ETS reply |
| MD-8 | 2 | MD-2 | — | MD-18 | Second machine for load generator |
| MD-9 | 2 | MD-2 | — | MD-17, MD-18 | — |
| MD-10 | 2 | — | MD-14 | MD-18 | Labelled question dataset, AI API key |
| MD-11 | 2 | — | — | MD-15, MD-17 (soft) | — |
| MD-12 | 2 | — | — | MD-16 | Participants available |
| MD-13 | 3 | MD-2 | — | MD-18 | — |
| MD-14 | 1 | — | — | MD-10 (soft), MD-18 | Real lecture PDFs from instructors |
| MD-15 | 3 | MD-6, MD-11 | MD-3 | MD-16 | — |
| MD-16 | 3 | MD-12, MD-15 | — | MD-19 | Participants show up |
| MD-17 | 3 | MD-1, MD-2, MD-9 | MD-11 | MD-18 (soft) | Test server reachable on campus network |
| MD-18 | 3 | MD-2, MD-3, MD-7, MD-8, MD-9, MD-10, MD-13, MD-14 | MD-17 | Release 1 planning | Advisor review slot |
| MD-19 | 3 | MD-16 | — | — | — |

### Same-sprint chains (do these in order within the week)

- **Sprint 1:** MD-1 → MD-2. Start MD-1 on day 1. MD-2 needs at least 2–3 days after.
- **Sprint 1:** MD-5 → MD-6. Finish MD-5 by mid-week.
- **Sprint 3 (critical path):** MD-15 → MD-16 → MD-19. All three in one week is tight. Start MD-15 on day 1, book test sessions for day 3–4, and keep MD-19 small.
- **Sprint 3:** MD-3 → MD-15 step 4 (math/code slides). Do MD-3 in the first 2 days, or design the math/code slides last.

### Actions to clear external blockers early

| Action | For | When |
|---|---|---|
| Email ETS about SSO | MD-7 | Sprint 1, day 1 |
| Ask instructors for 3–5 real lecture PDFs | MD-14, MD-10 | Sprint 1, day 1 |
| Start collecting ~100 student questions (Thai/English) | MD-10 | Sprint 1 |
| Get AI API key and confirm free quota | MD-10 | Sprint 1 |
| Reserve a second machine for load tests | MD-8 | Sprint 1 |
| Recruit usability test participants | MD-12, MD-16 | Sprint 2, day 1 |
| Ask ETS/IT about a test server or open port on campus | MD-17 | Sprint 2 |
| Book advisor review | MD-18 | Sprint 2 |

## Findings note template (for every spike)

1. Goal and pass criteria
2. Setup (versions, hardware, network)
3. Method
4. Results (numbers, screenshots, graphs)
5. Verdict: pass / fail / pass with conditions
6. Recommendation and open questions

---

## Sprint 1 — Foundation and Flows (17 SP)

### MD-1 Repo and dev environment setup
- **Track:** Proto · **SP:** 3
- **Blocked by:** none
- **Blocks:** MD-2, MD-17
- **Description:** Set up the monorepo and local dev stack so spikes and the prototype share one baseline.
- **Steps:**
  1. Create the GitHub repo and set branch protection on `main` (PR + 1 review).
  2. Choose the monorepo tool (pnpm workspaces or Turborepo) and create `apps/web` and `apps/api`.
  3. Scaffold Next.js (TypeScript, Tailwind) in `apps/web`.
  4. Scaffold NestJS in `apps/api` with a `/health` endpoint.
  5. Write `docker-compose.yml` with PostgreSQL (`pgvector/pgvector` image), Redis, web, and api.
  6. Add shared ESLint, Prettier, and `tsconfig` base.
  7. Add a GitHub Actions workflow: install, lint, Jest.
  8. Add `.env.example` and write the README setup section.
  9. Each team member runs the setup from a clean clone to confirm it works.
- **Acceptance criteria:**
  - [ ] Next.js (TypeScript, Tailwind) frontend and NestJS backend in one repo
  - [ ] `docker-compose up` starts PostgreSQL with pgvector, Redis, frontend, and backend
  - [ ] GitHub Actions runs lint and Jest on every PR
  - [ ] README explains local setup in under 5 steps

### MD-2 Spike: WebSocket + Redis Pub/Sub PoC
- **Track:** Spike · **SP:** 3
- **Blocked by:** MD-1 (hard)
- **Blocks:** MD-8, MD-9, MD-13, MD-17 (all hard); MD-3 (soft)
- **Description:** Build a minimal NestJS WebSocket gateway that proves the real-time messaging model. This server is also the target for the MD-8 load test.
- **Steps:**
  1. Choose the transport: Socket.IO or raw `ws`. Record the reason (Socket.IO has reconnect and rooms built in; raw `ws` is lighter and easier to load test).
  2. Add a NestJS WebSocket gateway.
  3. Implement `join` with a 6-digit PIN that maps to a room.
  4. Implement `vote`: store the count in Redis, broadcast the new result to the room.
  5. Add the Redis adapter (or manual Pub/Sub) so broadcast works across instances.
  6. Run 2 api instances on different ports and confirm a vote on instance A reaches a client on instance B.
  7. Build a minimal HTML test client (no design) to join and vote by hand.
  8. Document the message schema (`join`, `vote`, `result`, `error`).
  9. Write the findings note.
- **Acceptance criteria:**
  - [ ] Client joins a room by 6-digit PIN
  - [ ] Vote sent by one client is broadcast to all clients in the room
  - [ ] Broadcast works across 2 backend instances through Redis Pub/Sub
  - [ ] Message schema (join, vote, broadcast, error) is documented
  - [ ] Findings note written

### MD-4 Competitor UX review and user journey maps
- **Track:** UX · **SP:** 2
- **Blocked by:** none
- **Blocks:** MD-5 (soft)
- **Description:** Review the UX of existing tools and map the journeys of our personas.
- **Steps:**
  1. Create free accounts on Mentimeter, Slido, Kahoot, and AhaSlides.
  2. For each tool, run one full session as host and as student. Take screenshots of each step.
  3. List what to copy and what to avoid for each tool (join flow, presenter control, results display).
  4. Re-read the interview notes and personas in the proposal.
  5. Draw the host journey map (prepare → present → after class) with pain points and feelings.
  6. Draw the student journey map (join → participate → after class).
  7. Mark opportunities where ModDeck solves a pain point.
  8. Share with the team in a 30-minute review.
- **Acceptance criteria:**
  - [ ] Review of Mentimeter, Slido, Kahoot, and AhaSlides: what to copy and what to avoid
  - [ ] Journey map for the host persona (instructor/TA)
  - [ ] Journey map for the student persona
  - [ ] Pain points from proposal interviews mapped to journey steps

### MD-5 Information architecture and user flows
- **Track:** UX · **SP:** 3
- **Blocked by:** MD-4 (soft), MD-7 (soft — SSO login step can use a placeholder)
- **Blocks:** MD-6 (hard)
- **Description:** Define the screen structure and main flows for Release 1 scope.
- **Steps:**
  1. List all Release 1 features from the proposal roadmap.
  2. Draw the sitemap for the host side and the student side.
  3. Draw the host flow: login (SSO) → create deck → add activity → present → view results.
  4. Draw the student flow: scan QR / enter PIN → (SSO or guest) → answer activities → ask in Q&A.
  5. Add edge case branches: late join, disconnect and rejoin, session ended, invalid PIN, session full.
  6. Define the states of each activity (draft, live, closed, results shown).
  7. Review with the whole team and fix gaps.
- **Acceptance criteria:**
  - [ ] Sitemap for host and student
  - [ ] Host flow: create deck → add activity → present → view results
  - [ ] Student flow: scan QR / enter PIN → answer activities → ask in Q&A
  - [ ] Edge cases covered: late join, disconnect, session ended, invalid PIN
  - [ ] Flows reviewed by the whole team

### MD-6 Low-fi wireframes
- **Track:** UX · **SP:** 3
- **Blocked by:** MD-5 (hard)
- **Blocks:** MD-15 (hard)
- **Description:** Low-fidelity wireframes for the key screens.
- **Steps:**
  1. Set up the Figma file with pages: Student, Host, Archive.
  2. Wireframe student mobile screens: join (QR / PIN), waiting, Live Poll, Word Cloud input, Q&A list (upvote, anonymous toggle), session ended.
  3. Wireframe the host deck editor: slide list, slide canvas, add activity panel.
  4. Wireframe the host presenter control: current slide, activity controls (start / stop / show results), Q&A panel, timer.
  5. Wireframe the projector view (what the audience sees).
  6. Walk through the MD-5 flows on the wireframes and fix missing screens.
  7. Team review: confirm the host can run all activities from one screen.
- **Acceptance criteria:**
  - [ ] Student mobile: join, Live Poll, Word Cloud, Q&A (with upvote and anonymous toggle)
  - [ ] Host: deck editor, single-screen presenter control
  - [ ] Presenter control lets the host run all activities without switching screens

### MD-7 KMUTT SSO check and guest identity model
- **Track:** Spike · **SP:** 1
- **Blocked by:** none
- **Blocks:** MD-5 (soft), MD-18 (hard)
- **External blocker:** ETS reply. Send the email on day 1; the reply can take days.
- **Description:** Confirm SSO integration path with ETS and define how guest users are identified.
- **Steps:**
  1. Email ETS (LEB2 team) to ask for: SSO protocol, test environment, client registration process, and available user attributes (student ID, name, role).
  2. Book a short call if the answer is unclear.
  3. Write the guest join rules: nickname only, or nickname + student ID for graded quizzes.
  4. Define how a guest keeps the same identity on rejoin (device token in local storage).
  5. Escalate blockers to the advisor.
- **Acceptance criteria:**
  - [ ] ETS confirms SSO protocol (OIDC, SAML, or CAS) and test environment access
  - [ ] Rules written for guest join and linking answers to a student ID for grading
  - [ ] Blockers (if any) escalated to the advisor

### MD-14 Spike: PDF slide import and text extraction
- **Track:** Spike · **SP:** 2
- **Blocked by:** none (standalone script, does not need MD-1)
- **Blocks:** MD-10 (soft — provides Thai slide text), MD-18 (hard)
- **External blocker:** Real lecture PDFs from instructors. Ask on day 1.
- **Description:** Verify that existing slides can be imported and their text extracted for AI features. Placed in Sprint 1 so MD-10 has real slide text in Sprint 2.
- **Steps:**
  1. Collect 3–5 real lecture PDFs (Thai and English; exported from PowerPoint, Google Slides, and Canva).
  2. Convert each page to an image (for example `pdfjs-dist`, `pdf2pic`, or `poppler`).
  3. Extract text per page with `pdfjs-dist`. Check Thai text for broken vowels and tone marks.
  4. If extraction fails, try one fallback (another library or OCR) and note the result.
  5. Measure processing time and output size for a 50-slide deck.
  6. Save the extracted text in a format MD-10 can load (JSON: deck, page, text).
  7. Write the findings note.
- **Acceptance criteria:**
  - [ ] PDF converted to one image per slide
  - [ ] Text extracted per slide, Thai text quality checked
  - [ ] Processing time for a 50-slide deck recorded
  - [ ] Extracted text saved for MD-10
  - [ ] Findings note written

---

## Sprint 2 — Load and AI Spikes, Design System (17 SP)

### MD-8 Spike: Load test with 300 concurrent users
- **Track:** Spike · **SP:** 5
- **Blocked by:** MD-2 (hard)
- **Blocks:** MD-18 (hard)
- **External blocker:** Second machine for the load generator.
- **Description:** Load test the MD-2 WebSocket server directly with simulated clients (k6 or Artillery). No real UI is needed. The tool speaks the WebSocket protocol in place of browsers.
- **Steps:**
  1. Choose the tool: k6 (supports raw WebSocket) or Artillery (has a Socket.IO engine). Pick the one that matches the MD-2 transport.
  2. Prepare 2 machines: one for the server stack, one for the load generator. Record hardware specs.
  3. Add Prometheus metrics to the api (connections, messages/sec, event loop lag) and set up a Grafana dashboard.
  4. Write scenario 1 (ramp): ramp up to 300 connections in one room, hold for 5 minutes.
  5. Write scenario 2 (burst): 300 clients send a vote within 1 second. Each client measures time from send to broadcast received.
  6. Write scenario 3 (sustained): Q&A-style traffic, e.g. 5 messages/sec per room for 10 minutes.
  7. Run each scenario 3 times. Record p50/p95/p99 latency, CPU, memory, and dropped messages.
  8. If it fails, find the bottleneck (event loop, Redis, broadcast fan-out), fix it once, and rerun.
  9. Stretch: 2 api instances behind Nginx, 1,000+ connections across several rooms.
  10. Write the findings note with graphs.
- **Acceptance criteria:**
  - [ ] Test script opens 300 WebSocket connections in one room
  - [ ] Burst scenario: 300 votes sent within 1 second
  - [ ] p50/p95/p99 latency, CPU, memory, and dropped messages recorded
  - [ ] Load generator runs on a different machine than the server
  - [ ] Basic Prometheus + Grafana dashboard shows the run
  - [ ] Pass = p95 < 150 ms and 0 dropped messages
  - [ ] Stretch: 2 instances behind Nginx, 1,000+ connections across several rooms
  - [ ] Findings note written

### MD-9 Spike: Burst writes and leaderboard
- **Track:** Spike · **SP:** 3
- **Blocked by:** MD-2 (hard)
- **Blocks:** MD-17 (hard), MD-18 (hard)
- **Description:** Prove the write strategy that avoids database bottlenecks and race conditions when 300 users answer at once.
- **Steps:**
  1. Design the Redis keys: vote counts (`HINCRBY`), per-user answer (`SET NX` to block duplicates), leaderboard (`ZADD` / `ZINCRBY`).
  2. Implement answer submit with an atomic step (Lua script or `MULTI`) so a user cannot answer twice.
  3. Implement a batch flush job from Redis to PostgreSQL (every N seconds or on activity close).
  4. Write a concurrency test: 300 parallel submits, plus duplicate submits from the same user.
  5. Compare the final Redis count, PostgreSQL rows, and expected total.
  6. Measure leaderboard top-10 read time with 300 players.
  7. Test what happens if Redis restarts before a flush (data loss window).
  8. Write the findings note.
- **Acceptance criteria:**
  - [ ] Votes and scores written to Redis first (INCR / ZSET)
  - [ ] Batch flush from Redis to PostgreSQL
  - [ ] Concurrency test shows no lost or double-counted answers
  - [ ] Leaderboard top-N read time recorded
  - [ ] Findings note written

### MD-10 Spike: Embeddings and pgvector clustering
- **Track:** Spike · **SP:** 5
- **Blocked by:** MD-14 (soft — slide text can be copied by hand if MD-14 slips)
- **Blocks:** MD-18 (hard)
- **External blockers:** Labelled question dataset (start collecting in Sprint 1). AI API key with enough free quota.
- **Description:** Validate semantic Q&A clustering and slide lookup for mixed Thai/English questions. This is the highest-risk spike.
- **Steps:**
  1. Collect ~100 student-style questions (Thai, English, and mixed) for 1–2 real lecture decks. Start in Sprint 1 (ask friends and TAs).
  2. Label the data by hand: which questions belong to the same group, and which slide answers each question.
  3. Pick 2+ embedding models: an API model (for example Gemini embeddings) and a self-hosted model (for example `multilingual-e5`, `bge-m3`).
  4. Create the pgvector table and index (HNSW) for slide text and questions.
  5. Embed slide text (from MD-14) and all questions with each model.
  6. Clustering test: group questions by cosine similarity threshold. Measure precision against the labels and tune the threshold.
  7. Slide lookup test: for each question, get the top-3 slides. Measure top-3 accuracy.
  8. Measure latency per question (embedding + search) and cost per 1,000 questions.
  9. Write a short note on data privacy: what leaves KMUTT if an external API is used.
  10. Write the findings note with the model recommendation.
- **Acceptance criteria:**
  - [ ] Dataset of ~100 labelled real-style student questions (Thai and English mixed)
  - [ ] At least 2 embedding models compared (for example Gemini embeddings vs locally hosted multilingual-e5)
  - [ ] Metrics recorded: clustering precision, slide lookup top-3 accuracy, latency per question
  - [ ] Decision on data handling: external AI API vs self-hosted model (privacy and cost)
  - [ ] Findings note written

### MD-11 Design system foundation
- **Track:** UX · **SP:** 2
- **Blocked by:** none
- **Blocks:** MD-15 (hard), MD-17 (soft — can use default Tailwind first)
- **Description:** Base design system in Figma that maps 1:1 to Tailwind config.
- **Steps:**
  1. Choose the Thai-capable font (for example IBM Plex Sans Thai, Noto Sans Thai, Anuphan) and test it with mixed Thai/English text.
  2. Define color tokens (primary, neutral, success, warning, error) and check contrast (WCAG AA).
  3. Define the type scale, spacing, and radius tokens.
  4. Build core components in Figma: button, input, card, toggle, badge, chart styles.
  5. Test colors and font size on a real projector and on a phone outdoors.
  6. Export tokens to `tailwind.config` in the repo.
- **Acceptance criteria:**
  - [ ] Tokens: color, typography (Thai-capable font), spacing, radius
  - [ ] Core components: button, card, input, chart styles
  - [ ] Contrast readable on a projector and on mobile in bright rooms

### MD-12 Usability test plan and recruiting
- **Track:** UX · **SP:** 2
- **Blocked by:** none
- **Blocks:** MD-16 (hard)
- **External blocker:** Participants available in Sprint 3. Recruit on Sprint 2 day 1.
- **Description:** Prepare the Sprint 3 usability test.
- **Steps:**
  1. Define test goals (for example: can a new instructor start a poll in under 2 minutes?).
  2. Write 4–6 tasks for students and 4–6 tasks for instructors.
  3. Write the test script (intro, consent, tasks, follow-up questions).
  4. Prepare the note-taking template and severity scale (1 cosmetic – 4 blocker).
  5. Recruit and book 3–5 students and 2–3 instructors/TAs (use the proposal interviewees first). Book slots for Sprint 3 day 3–4.
  6. Book rooms or online meeting slots.
- **Acceptance criteria:**
  - [ ] Test goals, tasks, and script written
  - [ ] 3–5 students and 2–3 instructors/TAs booked
  - [ ] Note-taking template and severity scale ready

---

## Sprint 3 — Resilience, Prototype, Decision (17 SP)

### MD-3 Spike: Math and code rendering
- **Track:** Spike · **SP:** 2
- **Blocked by:** MD-2 (soft — can use a mock WebSocket server)
- **Blocks:** MD-15 step 4 (soft), MD-18 (hard)
- **External blocker:** Test phones (low-end Android, iPhone) and a room with a projector.
- **Description:** Verify that KaTeX and a syntax highlighter (Shiki or PrismJS) render correctly and fast on student phones and the projector screen when content arrives through WebSocket. Do this in the first 2 days of Sprint 3 so MD-15 can use the result.
- **Steps:**
  1. Prepare test content: 5 LaTeX formulas (simple to complex: matrix, integral, summation) and 3 code blocks (Python, Java, SQL; one with 50+ lines).
  2. Build a test page in Next.js that renders KaTeX.
  3. Add Shiki and PrismJS versions of the code renderer.
  4. Send the content as a WebSocket payload (use the MD-2 server) and render on receive.
  5. Measure render time (Performance API) and bundle size (`next build` output) for each option.
  6. Test on a low-end Android phone, an iPhone, and a 1080p projector. Take screenshots.
  7. Check text size and readability from the back of a lecture room.
  8. Write the findings note with a Shiki vs PrismJS recommendation.
- **Acceptance criteria:**
  - [ ] Complex LaTeX formula and 50+ line code block render correctly from a WebSocket payload
  - [ ] Tested on a low-end Android phone, an iPhone, and a 1080p projector
  - [ ] Render time and bundle size impact recorded
  - [ ] Recommendation: Shiki vs PrismJS
  - [ ] Findings note written

### MD-13 Spike: Reconnect and state recovery
- **Track:** Spike · **SP:** 3
- **Blocked by:** MD-2 (hard)
- **Blocks:** MD-18 (hard)
- **Description:** Prove that students who lose WiFi can rejoin without losing data (main Mentimeter pain point from interviews).
- **Steps:**
  1. Define the session token the client stores (user ID, session ID, last event sequence number).
  2. Add a sequence number to every server event.
  3. Implement the reconnect handshake: client sends token + last sequence; server returns the current state (or missed events).
  4. Implement idempotent answer submit with a client-generated answer ID.
  5. Test: turn WiFi off mid-quiz for 5 s, 30 s, and 2 min, then turn it on.
  6. Test: restart the api server during a session.
  7. Test: answer submitted while offline is retried and counted once.
  8. Write the findings note.
- **Acceptance criteria:**
  - [ ] Client drops network mid-quiz and rejoins the same session automatically
  - [ ] Answers, score, and team are restored after rejoin
  - [ ] Answer submission is idempotent (retry does not double count)
  - [ ] Server restart scenario tested
  - [ ] Findings note written

### MD-15 Hi-fi mockups for Release 1 scope
- **Track:** UX · **SP:** 3
- **Blocked by:** MD-6 (hard), MD-11 (hard), MD-3 (soft — only step 4)
- **Blocks:** MD-16 (hard)
- **Note:** Critical path for Sprint 3. Start on day 1.
- **Steps:**
  1. Apply the design system to the student mobile wireframes.
  2. Apply the design system to the host editor and presenter control.
  3. Design the projector view for each activity (poll chart, word cloud, Q&A).
  4. Design math and code slides using MD-3 results (do this step last).
  5. Add empty, loading, and error states (including "reconnecting…").
  6. Team review and fix.
- **Acceptance criteria:**
  - [ ] Join, Live Poll, Word Cloud, Q&A (upvote, anonymous)
  - [ ] Presenter control screen
  - [ ] Math and code slides
  - [ ] Empty, loading, and error states

### MD-16 Clickable prototype and usability test
- **Track:** UX · **SP:** 3
- **Blocked by:** MD-12 (hard), MD-15 (hard)
- **Blocks:** MD-19 (hard)
- **External blocker:** Booked participants show up. Have 1–2 backup participants.
- **Steps:**
  1. Link the hi-fi screens into clickable Figma prototypes (one for student, one for host).
  2. Do a pilot test with a team member and fix the script.
  3. Run the test sessions with the MD-12 participants. One person leads, one takes notes.
  4. Record task success, time on task, and quotes.
  5. Group the findings and rank them by severity.
  6. Present the top findings to the team.
- **Acceptance criteria:**
  - [ ] Clickable Figma prototype for host and student flows
  - [ ] Test sessions run with MD-12 participants
  - [ ] Findings ranked by severity

### MD-17 Walking skeleton: Live Poll end to end
- **Track:** Proto · **SP:** 3
- **Blocked by:** MD-1 (hard), MD-2 (hard), MD-9 (hard), MD-11 (soft)
- **Blocks:** MD-18 (soft)
- **External blocker:** Test server reachable from the campus network (ask ETS/IT in Sprint 2).
- **Description:** First working vertical slice built on spike results.
- **Steps:**
  1. Host page: create a poll (question + options). A PIN and QR code are generated.
  2. Student page: enter the PIN or scan the QR code, then join as guest.
  3. Student votes; the vote goes through the MD-9 Redis write path.
  4. Host page shows a live bar chart (batched updates every 100–200 ms).
  5. Host closes the poll; results are saved to PostgreSQL.
  6. Deploy to a test server reachable from the campus network.
  7. Demo with 10+ real phones on campus WiFi.
- **Acceptance criteria:**
  - [ ] Host creates a poll
  - [ ] Student joins by PIN on a phone and votes
  - [ ] Live chart updates on the host screen
  - [ ] Demo works on the campus network

### MD-18 Feasibility report, ADRs, and go/no-go
- **Track:** Spike · **SP:** 2
- **Blocked by:** MD-2, MD-3, MD-7, MD-8, MD-9, MD-10, MD-13, MD-14 (all hard); MD-17 (soft)
- **Blocks:** Release 1 sprint planning
- **External blocker:** Advisor review slot (book in Sprint 2).
- **Steps:**
  1. Collect all spike findings notes.
  2. Write one ADR per decision (transport, write strategy, embedding model, renderer, reconnect design, PDF library, SSO).
  3. Fill the go/no-go table per risky feature with evidence links.
  4. List features to cut, change, or move to a later release.
  5. Re-estimate the Release 1 backlog with the team.
  6. Share the report with the advisor and collect feedback.
- **Acceptance criteria:**
  - [ ] One Architecture Decision Record per spike
  - [ ] Go/no-go per risky feature (real-time scale, AI clustering, math/code, resilience, slide import, SSO)
  - [ ] Release 1 backlog re-estimated from findings
  - [ ] Report shared with the advisor

### MD-19 Design changes from usability findings
- **Track:** UX · **SP:** 1
- **Blocked by:** MD-16 (hard)
- **Blocks:** none
- **Steps:**
  1. Take all severity 3–4 findings from MD-16.
  2. Update the affected screens in Figma.
  3. Log severity 1–2 findings as backlog items for Release 1.
- **Acceptance criteria:**
  - [ ] All high-severity findings fixed in the mockups

---

## Risks and Notes

- **Thai language (MD-10):** The proposal does not mention Thai, but most student questions will be in Thai. Weak Thai embeddings can break clustering and slide lookup. Start collecting the question dataset in Sprint 1.
- **Self-hosted vs external AI:** The proposal promises self-hosting but lists Gemini. MD-10 must decide this; ETS will likely ask.
- **Sprint 3 critical path:** MD-15 → MD-16 → MD-19 in one week. If MD-15 slips, MD-16 and MD-19 slip too.
- **No buffer:** Each sprint is planned at full capacity. If a sprint slips, move MD-19 first, then cut the MD-8 stretch goal.
- **Out of scope:** Team mode, session analytics, AI Suggestion (Release 2/3). These do not need feasibility proof now.
