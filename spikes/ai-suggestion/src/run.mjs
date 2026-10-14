// Usage: node src/run.mjs <provider> [deck...] [--runs N]
// Run 1 is the one rated. Extra runs only add latency samples.
import { mkdirSync, writeFileSync } from "node:fs";
import { DECKS, loadDeck, deckToText } from "./decks.mjs";
import { SYSTEM, userPrompt } from "./prompt.mjs";
import { getProvider } from "./providers.mjs";

process.loadEnvFile?.(new URL("../../../.env", import.meta.url));

const args = process.argv.slice(2);
const runsAt = args.indexOf("--runs");
const runs = runsAt >= 0 ? Number(args.splice(runsAt, 2)[1]) : 1;
const [providerName, ...deckIds] = args;
const provider = getProvider(providerName);
const decks = deckIds.length ? deckIds : Object.keys(DECKS);

const dir = new URL(`../out/${providerName}/`, import.meta.url);
mkdirSync(dir, { recursive: true });

for (const id of decks) {
  const deck = loadDeck(id);
  const user = userPrompt(deck, deckToText(deck));
  const results = [];
  const save = () =>
    writeFileSync(
      new URL(`${id}.json`, dir),
      JSON.stringify(
        {
          provider: providerName,
          deck: id,
          lang: deck.lang,
          slides: deck.slides.length,
          at: new Date().toISOString(),
          results,
        },
        null,
        2,
      ),
    );
  for (let i = 0; i < runs; i++) {
    try {
      const r = await provider.generate(SYSTEM, user);
      results.push(r);
      console.log(
        `${providerName} ${id} run ${i + 1}: ${(r.ms / 1000).toFixed(1)} s, in ${r.inTokens}, out ${r.outTokens}, think ${r.thinkTokens}, ${r.json.suggestions.length} suggestions`,
      );
    } catch (e) {
      results.push({ error: String(e.message ?? e) });
      console.log(`${providerName} ${id} run ${i + 1}: ERROR ${e.message}`);
    }
    save(); // after each run, so a stopped run keeps what it has
  }
}
