// Usage: node src/build-sheet.mjs -> rating/rating-sheet.html
// One self-contained page for the teacher. Items are shuffled and the model name is hidden.
// The teacher clicks a rating per item and downloads ratings JSON for src/score.mjs.
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadItems } from "./items.mjs";
import { DECKS, loadDeck } from "./decks.mjs";

const items = loadItems();
const decks = Object.fromEntries(Object.keys(DECKS).map((id) => [id, loadDeck(id)]));
const hash = (s) => createHash("sha1").update(s).digest("hex");
const shuffled = items
  .map((it) => ({ it, k: hash(`md-ai-${it.id}`) }))
  .sort((a, b) => a.k.localeCompare(b.k))
  .map(({ it, k }) => {
    const slides = decks[it.deck].slides.filter(
      (s) => s.page >= it.after_slide - 1 && s.page <= it.after_slide,
    );
    const { provider, ...rest } = it;
    return { ...rest, code: k.slice(0, 6), deckTitle: decks[it.deck].title, context: slides };
  });

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Suggestion Rating</title>
<style>
:root{--bg:#fafaf9;--card:#fff;--fg:#1c1917;--muted:#78716c;--line:#e7e5e4;--ok:#15803d;--edit:#b45309;--bad:#b91c1c;--accent:#4f46e5}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--card:#292524;--fg:#f5f5f4;--muted:#a8a29e;--line:#44403c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,"Noto Sans Thai",sans-serif}
main{max-width:860px;margin:0 auto;padding:16px}
header{position:sticky;top:0;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line);z-index:1;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
h1{font-size:20px;margin:0 auto 0 0}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:14px 0}
.meta{color:var(--muted);font-size:13px}.q{font-weight:600;margin:8px 0}ol{margin:4px 0 8px 20px;padding:0}li.correct{font-weight:600;color:var(--ok)}
details{margin:8px 0;font-size:13px}pre{white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:6px;max-height:240px;overflow:auto}
.btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;padding:6px 10px;cursor:pointer}
button[data-r=usable].on{background:var(--ok);color:#fff}button[data-r=edit].on{background:var(--edit);color:#fff}button[data-r=unusable].on{background:var(--bad);color:#fff}
textarea{width:100%;font:inherit;margin-top:6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);padding:6px}
.tag{display:inline-block;padding:0 6px;border-radius:4px;background:var(--line);font-size:12px;margin-right:4px}
</style></head><body><main>
<header><h1>AI Suggestion rating</h1><span id="progress" class="meta"></span><input id="rater" placeholder="Your name" aria-label="Rater name"><button id="dl">Download ratings</button></header>
<p class="meta">Each card is one activity an AI suggested for a lecture deck. Rate it as you would before using it in class:
<b>Usable</b> = use as is. <b>Edit needed</b> = good idea, needs a small fix (wording, an option, the position). <b>Unusable</b> = wrong, off-topic, or more work to fix than to write new.
Judge the position (after which slide), the question, the options and the marked answer. Add a note for edit needed and unusable.</p>
<div id="list"></div></main>
<script>
const ITEMS=${JSON.stringify(shuffled).replace(/</g, "\u003c")};
const KEY="md-ai-rating";let state={};try{state=JSON.parse(localStorage.getItem(KEY)||"{}")}catch{}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const list=document.getElementById("list");
ITEMS.forEach((it,n)=>{const c=document.createElement("section");c.className="card";
c.innerHTML=\`<div class="meta">#\${n+1} · \${esc(it.code)} · \${esc(it.deckTitle)} (\${it.slides} slides)</div>
<div><span class="tag">\${it.type}</span><span class="tag">after slide \${it.after_slide}</span></div>
<div class="q">\${esc(it.question)}</div><ol>\${it.options.map((o,i)=>\`<li class="\${i===it.correct_option?"correct":""}">\${esc(o)}\${i===it.correct_option?" ✓":""}</li>\`).join("")}</ol>
<div class="meta"><b>Why here:</b> \${esc(it.reason)}</div><div class="meta"><b>Shown after answer:</b> \${esc(it.explanation)}</div>
<details><summary>Slide text around this point</summary>\${it.context.map(s=>\`<pre><b>Slide \${s.page}</b>\n\${esc(s.text)}</pre>\`).join("")}</details>
<div class="btns">\${["usable","edit","unusable"].map(r=>\`<button data-r="\${r}">\${{usable:"Usable",edit:"Edit needed",unusable:"Unusable"}[r]}</button>\`).join("")}</div>
<textarea rows="2" placeholder="Note (what to fix)"></textarea>\`;
const s=state[it.id]||{};const paint=()=>c.querySelectorAll("button").forEach(b=>b.classList.toggle("on",b.dataset.r===(state[it.id]||{}).rating));
c.querySelectorAll("button").forEach(b=>b.onclick=()=>{state[it.id]={...(state[it.id]||{}),rating:b.dataset.r};save();paint();progress()});
const ta=c.querySelector("textarea");ta.value=s.note||"";ta.oninput=()=>{state[it.id]={...(state[it.id]||{}),note:ta.value};save()};
paint();list.append(c)});
const progress=()=>document.getElementById("progress").textContent=\`\${ITEMS.filter(i=>state[i.id]?.rating).length} / \${ITEMS.length} rated\`;progress();
document.getElementById("dl").onclick=()=>{const rater=document.getElementById("rater").value||"teacher";
const blob=new Blob([JSON.stringify({rater,at:new Date().toISOString(),ratings:state},null,2)],{type:"application/json"});
const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=\`ratings-\${rater.replace(/\W+/g,"-")}.json\`;a.click()};
</script></body></html>`;

mkdirSync(new URL("../rating/", import.meta.url), { recursive: true });
writeFileSync(new URL("../rating/rating-sheet.html", import.meta.url), html);
console.log(`rating/rating-sheet.html: ${shuffled.length} items`);
