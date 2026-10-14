# AI Suggestion Findings: activity insertion points and poll/quiz generation

**Verdict: pass on quality, with two gaps.** Gemini reads the MD-14 slide text, suggests where to insert activities, and writes poll and quiz questions that testers rated usable or edit-needed in 97% of ratings, in Thai and in English. The gaps: only 3 testers rated, and `gemini-3.8-flash` has not been tested on Thai decks (sections 4.1, 6 and 8).

- **Quality.** 3 testers rated all 29 suggestions each (87 ratings). `gemini-3.1-flash-lite`: **96%** usable or edit-needed (EN 93%, TH 100%). `gemini-3.8-flash`: 100% on the English decks. `gemini-3.8-flash` with low thinking: 92% on 4 suggestions. Every group passes the 70% mark for every tester. Only 3 of 87 ratings were "unusable", all from one tester. `gemini-3.8-flash` was not run on the Thai decks because the free-tier quota ran out (section 4.4).
- **Latency.** `gemini-3.1-flash-lite` takes **2.5–4.1 s per deck**. On the free tier, `gemini-3.8-flash` takes **129–209 s per deck**, and 2 of 3 calls on the 37-slide deck failed (section 4.2).
- **Cost per deck.** `gemini-3.1-flash-lite`: about **$0.002**. `gemini-3.8-flash`: about **$0.013–0.022** at the introductory price, and about $0.025–0.043 from 1 Jan 2027. The user pays with their own key (section 4.3).
- **Decision (14 Oct): pick one.** The team dropped the self-hosted LLM. The product calls Gemini with **the user's own API key**. Default model: `gemini-3.1-flash-lite`. Keep the model name in config, so that a user can choose a larger model (section 7).

## 1. Goal and pass criteria

Check the AI Suggestion promise from the proposal (section 3: "ก่อนสอน: ระบบ AI Suggestion วิเคราะห์เนื้อหาสไลด์เพื่อแนะนำจุดแทรกกิจกรรม และช่วยสร้างโจทย์ Poll/Quiz อัตโนมัติ").

- [x] Use the MD-14 text extraction from 3–5 real Thai and English lecture decks. 4 decks are used: 2 English, 2 Thai.
- [~] Prompt Gemini and one self-hosted LLM. **Gemini only.** The team dropped the self-hosted option on 14 Oct (section 7).
- [~] A teacher rates each suggestion as usable, edit needed, or unusable. 3 testers rated all 29 suggestions with the local rating page (`rating/rating-sheet-local.html`). One gave the name "Ajarn Aunn"; the other two gave no name, so we cannot say how many are teachers. Only their result tables were kept, not per-suggestion ratings (section 6).
- [x] Latency per deck measured.
- [x] Cost per deck measured from the API token counts.

Pass criteria:

| Criterion | Result |
| --- | --- |
| At least 70% usable or edit needed, Thai and English | **Pass.** flash-lite: EN 93%, TH 100%. 3.8-flash: EN 100%, TH not tested. Lowest single tester in any group: 75% (section 4.1). |
| Latency per deck within the budget for an async prep-time job | **Pass for flash-lite** (≤ 4.1 s). 3.8-flash on the free tier misses the 60 s target (section 4.2). |
| Cost per deck known | **Pass.** Known for both models (section 4.3). |

**Latency budget.** No budget is agreed yet. This note uses a working budget: a suggestion job should finish in **60 s per deck** (the teacher waits on the import page), with a **hard limit of 5 min**. After 5 min, the job fails and the teacher can retry. Confirm this in MD-18.

## 2. Setup

| Item | Value |
| --- | --- |
| Machine | AMD Ryzen 5 5500, 16 GB RAM, Windows 11, Node.js 22.13.0. The API calls run from this PC. |
| API | Gemini API `generateContent`, JSON output with `responseJsonSchema`, `temperature` 0.4. **Free-tier key.** |
| Models | `gemini-3.1-flash-lite` (default thinking: minimal), `gemini-3.8-flash` (default thinking: high), `gemini-3.8-flash` with `thinkingLevel: LOW`. `gemini-3.5-flash` returned 503 "high demand" on every call. `gemini-2.5-flash` returned 404 "no longer available to new users". |
| Slides | MD-14 `data/slides-text.json`, cleaned with the MD-10 `cleanSlideText()`. Lecturer email and phone are replaced with `[email]` and `[phone]` before sending. |

Decks:

| Id | Deck | Slides | Main language | Input tokens |
| --- | --- | --- | --- | --- |
| vue1 | Chapter 1 – Introduction to Vue 3 | 20 | English (one Thai policy slide) | 2,885 |
| vue3 | Chapter 3 – Reactive Form Binding | 37 | English | 4,764 |
| w07 | INT319 W07 Corporate Strategy II | 22 | Thai, with English terms | 3,752 |
| w08 | INT319 W08 Marketing | 19 | Thai, with English terms | 2,340 |

## 3. Method

1. `src/decks.mjs` loads a deck and writes it as one block per slide: `[Slide N]` and the slide text.
2. `src/prompt.mjs` holds one system prompt and a JSON schema. The model returns 3–6 suggestions. Each suggestion has `after_slide`, `type` (`quiz` or `poll`), `reason` (for the teacher), `question`, `options` (2–5), `correct_option` (-1 for a poll) and `explanation` (shown to students). The rules in the prompt: about 1 activity per 5–8 slides, a quiz comes after the content it tests, no activity after the title slide or the last slide, quiz facts come only from the slides, and the text uses the main language of the slides.
3. `src/run.mjs <model> --runs 3` sends each deck 3 times. Run 1 is the one rated. Runs 2 and 3 only add latency samples.
4. `src/check.mjs` writes `data/metrics.json`. It has the median and maximum latency, the token counts and the cost per deck. It also runs mechanical checks on each suggestion: position, number of options, a valid correct option, and a Thai question on a Thai deck.
5. The testers used a local rating page (`rating/rating-sheet-local.html`). It shuffles the suggestions and hides the model name while rating. It shows the slide text around each insertion point. The tester clicks a rating, and the page calculates a results table on the device. Nothing is sent anywhere. The tester captures the table as a screenshot.
6. `src/build-sheet.mjs` and `src/score.mjs` are the first version of this step (download a JSON file, then score it). They are no longer used for the ratings in section 4.1.

Run it:

```sh
cd spikes/ai-suggestion
node src/run.mjs gemini-3.1-flash-lite --runs 3   # needs GEMINI_API_KEY in the repo .env
node src/run.mjs gemini-3.8-flash --runs 3
node src/check.mjs                                # writes data/metrics.json
node src/build-sheet.mjs                          # first-version rating sheet (JSON download)
node src/score.mjs data/ratings-provisional.json  # scores a ratings JSON file
```

The tester results in section 4.1 are in `data/ratings-summary.json`.

## 4. Results

### 4.1 Quality

**Tester ratings.** 3 testers each rated all 29 suggestions, with the model name hidden. The table adds their counts (ratings = suggestions × testers). Source: `data/ratings-summary.json`.

| Model | Language | Suggestions | Ratings | Usable | Edit needed | Unusable | Usable + edit | Lowest tester |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | English | 9 | 27 | 16 | 9 | 2 | **93%** | 78% |
| gemini-3.1-flash-lite | Thai | 8 | 24 | 17 | 7 | 0 | **100%** | 100% |
| gemini-3.1-flash-lite | All | 17 | 51 | 33 | 16 | 2 | **96%** | |
| gemini-3.8-flash | English | 8 | 24 | 16 | 8 | 0 | **100%** | 100% |
| gemini-3.8-flash | Thai | 0 | – | – | – | – | not tested | |
| gemini-3.8-flash (low thinking) | English | 4 | 12 | 9 | 2 | 1 | **92%** | 75% |
| All models | All | 29 | 87 | 58 | 26 | 3 | **97%** | 90% |

Per tester, over all 29 suggestions:

| Tester | Usable | Edit needed | Unusable | Usable + edit |
| --- | --- | --- | --- | --- |
| Rater 1 | 22 | 7 | 0 | 100% |
| Rater 2 | 17 | 9 | 3 | 90% |
| Rater 3 (Ajarn Aunn) | 19 | 10 | 0 | 100% |

- **Every group passes for every tester.** The lowest result is 75% (low-thinking 3.8-flash, 4 suggestions, Rater 2).
- **Rater 2 is the strict one.** All 3 "unusable" ratings are theirs: 2 on flash-lite English and 1 on low-thinking 3.8-flash. The results tables do not show which suggestions these are, so we cannot say why. Per-suggestion ratings were not kept.
- **Thai is not weaker.** flash-lite is 100% on Thai for all three testers. English has the 2 unusable ratings, so the English figure (93%) is the lower one.
- **Testers rate "edit needed" often** (26 of 87, 30%). The product should make editing a suggestion easy, because a third of suggestions will be edited before use.
- **Small sample.** 3 testers, one deck set, and only 4 suggestions for low-thinking 3.8-flash. Treat 92% there as a weak signal.

**Claude's check against the slide text** (earlier, provisional). Claude checked each suggestion for placement, a correct marked answer according to the slides, and plausible wrong options. `data/ratings-provisional.json` has a note for each. It found no wrong answers and no unusable suggestions, so it was more lenient than Rater 2 and close to Raters 1 and 3.

- **No wrong answers were found.** Every marked quiz answer matches the slides. The wrong options are plausible, for example `@submit.stop` / `.once` / `.self` against `@submit.prevent`.
- **Placement is good.** Quizzes come right after the slide that teaches the fact, and polls come at topic changes or before a workshop. One suggestion breaks the rule: flash-lite placed a quiz after the last slide of vue3.
- **The output language is not stable.** This is a likely reason for "edit needed" (the testers did not record reasons). flash-lite wrote all 4 W07 activities in **English** on a Thai deck, because the W07 slides it quoted are in English. It wrote vue3 activities in Thai. `gemini-3.8-flash` wrote all activities for the English Vue decks in **Thai**, because one slide in vue1 is Thai. A teacher may accept either language, but the product should not guess. Let the teacher choose the language (section 7).
- **One answer needs a check against the picture.** On W07 slide 15, the SWOT chart text is a set of labels with no layout. flash-lite matched "Strengths + Threats" to the "Defensive/Diversify" label. The text alone does not prove this. Diagram slides need OCR or a picture input (MD-14) for reliable quiz facts.
- **Bias in the answer position.** In an early test, `gemini-3.8-flash` put the correct answer first in all 3 quizzes. Across the rated set the positions are mixed, but the product should shuffle the options anyway.
- Most quizzes test recall of one slide. Few test application. This is fine for a check-in quiz, but teachers may want harder questions. A "difficulty" field in the prompt is a cheap next step.

### 4.2 Latency per deck

Measured from this PC, one deck at a time, 3 runs each.

| Model | vue1 (20) | vue3 (37) | w07 (22) | w08 (19) | Failed calls |
| --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 2.6 s (max 4.1) | 3.1 s (max 3.5) | 2.7 s (max 3.1) | 2.7 s (max 2.8) | 0 of 12 |
| gemini-3.8-flash | 195.5 s (max 209.4) | 128.6 s (1 run) | not run | not run | 2 of 6 |
| gemini-3.8-flash, low thinking | 158.5 s (max 194.5) | 154.8 s (1 run, not saved) | not run | not run | 0 of 4 |

- **flash-lite is well inside the budget**: under 5 s for every deck. A teacher could even wait for it on the import page.
- **`gemini-3.8-flash` on the free tier is slow.** It produces about 4–8 output tokens per second. Low thinking (0 thinking tokens) is not faster, so the time is queueing on Google's side, not thinking. The paid tier is probably faster, but this spike has no paid key to test it.
- **Failures seen:** one call failed with `fetch failed` after 300 s. This is Node's default header timeout: the API had not answered in 5 minutes. One call failed with 429 (daily quota). `gemini-3.5-flash` failed with 503 "This model is currently experiencing high demand" on every call. The job must retry and must show the teacher a clear error.

### 4.3 Cost per deck

Tokens come from the API `usageMetadata`. Thinking tokens are billed as output.

| Model | Price per 1M tokens (in / out) | Tokens per deck (in / out + thinking) | Cost per deck |
| --- | --- | --- | --- |
| gemini-3.1-flash-lite | $0.25 / $1.50 | 2,340–4,764 / 640–850 | **$0.0016–0.0025** |
| gemini-3.8-flash | $0.75 / $3.75 (until 31 Dec 2026) | 2,885–4,764 / 2,700–4,840 | **$0.013–0.022** |
| gemini-3.8-flash | $1.50 / $7.50 (from 1 Jan 2027) | same | $0.025–0.043 |
| gemini-3.8-flash, low thinking | $0.75 / $3.75 | 2,885 / 650 | $0.0046 |
| Free tier | $0 | same | $0, but 20 requests per day per model, and Google may use the data |

- One teacher with 15 decks per term costs about **$0.03 per term** with flash-lite, or about $0.35 with `gemini-3.8-flash`. Cost does not decide between the models.
- Thinking is most of the `gemini-3.8-flash` cost: 1,700–6,400 thinking tokens per deck against about 750 output tokens. Low thinking cuts the cost by about two thirds. Its 4 suggestions were rated 92% usable or edit-needed (section 4.1).
- The `gemini-3.8-flash` price is from the official Gemini API "What's new" page. The `gemini-3.1-flash-lite` price is from third-party listings (OpenRouter and others). Check it on the official pricing page before quoting it to users.

### 4.4 Free-tier limits

- The free tier allows **20 requests per day per model**. A failed call and each retry count too. This spike used up the `gemini-3.8-flash` quota on the English decks. The resets are daily, so the Thai decks were not run on this model.
- A teacher on a free key can make about 20 suggestion jobs per day per model. That is enough for one person, but retries must stop on a daily-quota 429. `src/providers.mjs` now stops on a `PerDay` quota error.

## 5. What was sent to Google in this run

The run used a **free-tier key**, so Google may use this data to improve its products. The team accepted this for the spike (14 Oct). The run sent:

- the text of 4 lecture decks (98 slides): Vue Chapter 1, Vue Chapter 3, INT319 W07 and INT319 W08, from the MD-14 import;
- about 50 requests in total, counting retries.

The lecturer's email and phone number were replaced before sending (`redact()` in `src/decks.mjs`). No student data was sent.

**Note on MD-10:** the `redact()` regex in `spikes/md-10-embeddings/src/models.mjs` is missing its backslashes (`[w.+-]+@…`, `d{2,3}…`). It matches nothing, so the MD-10 Gemini run probably sent the lecturer's contact details. This spike uses a fixed regex. Fix MD-10 too.

## 6. Rating by testers (partly done)

3 testers rated all 29 suggestions on 14 Oct (section 4.1). What is still open:

- **Who rated.** One tester gave the name "Ajarn Aunn". The other two gave no name. If the pass criterion needs teachers, confirm who they are, or repeat with named teachers.
- **Only counts were kept.** Each tester captured their results table, not their per-suggestion ratings and notes. We cannot say which suggestions were "unusable". If the product team wants to learn from the 3 unusable ratings, rerun the page (`rating/rating-sheet-local.html`) and copy each tester's notes.
- **The Thai side of `gemini-3.8-flash`.** Run it on w07 and w08 when the quota resets (or with a paid key), rebuild the page with the new suggestions, and rate them.

To run another round: open `rating/rating-sheet-local.html` in a browser (it works offline, apart from the font). It has 29 suggestions, shuffled, with no model names while rating. The results table at the bottom has a name box for the screenshot.

## 7. Decision and recommendation for the ADR (MD-18)

**Decision (14 Oct): pick one. Gemini with the user's own API key. No self-hosted LLM.**

- The team decided not to host an LLM. The self-hosted part of this spike was not run. A 7–8B model would need a GPU server, and the test VM in MD-10 has 4 vCPU and no GPU.
- Default model: **`gemini-3.1-flash-lite`**. It is fast (under 5 s), cheap (about $0.002 per deck), and its suggestions passed on both languages. Keep the model name in config. A user who wants more can pick `gemini-3.8-flash` with low thinking.
- This is the opposite of MD-10, where we support both (self-hosted embeddings or the user's Gemini key). Confirm whether the 14 Oct decision also drops the self-hosted embeddings, or only the self-hosted LLM.

How to build it:

- **Background job.** Run suggestions after the MD-14 import, on the same queue. Show "suggestions ready" on the deck. Retry 503 and per-minute 429 with backoff. Do not retry a daily-quota 429; tell the teacher their key is out of quota. Use a 5-minute limit per call.
- **Structured output.** Use the JSON schema. Then validate in code: clamp `after_slide` to 2…n-1, drop duplicate positions, check that `correct_option` is valid, and **shuffle the options** before saving.
- **Language.** Add a deck setting, "Activity language: Thai / English", with the default taken from the share of Thai characters in the deck. Pass it to the prompt. Do not let the model choose.
- **Teacher stays in control.** Show suggestions as drafts on the slide strip. One click inserts one, and every field can be edited. Never insert an activity without the teacher.
- **Key handling**, as in MD-10: encrypt the key at rest, never send it to the browser, never write it to logs. Before a free-tier key is saved, warn the user that Google may use the slide text.
- **Diagram slides.** Mark suggestions from slides with little text (`lowText`) or label-only text as "check against the slide". OCR or a picture input could help here later.

## 8. Open questions

- Who the 3 testers are, and per-suggestion ratings with notes (section 6). Ideally two teachers: one for the Vue decks, one for INT319.
- `gemini-3.8-flash` on the Thai decks (quota).
- Latency on a paid key. Is `gemini-3.8-flash` faster than 2–3 minutes when it is not free tier?
- Should the product also accept other providers' keys (OpenAI, Anthropic)? The prompt and schema are simple and should carry over, but this spike tested only Gemini.
- Should the suggestions use the slide images as well as the text? Gemini accepts images, and this could fix the diagram slides.
- Official price for `gemini-3.1-flash-lite`.
