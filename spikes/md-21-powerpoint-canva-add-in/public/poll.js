// Read-only poll view. Runs inside a PowerPoint content add-in, or in a plain
// browser tab with ?pin=123456 for testing. It never emits `vote`.
//
// Load order is tuned for slideshow, where PowerPoint starts the add-in when
// the slide appears: the poll cached in the deck is drawn first, while the
// socket and a fresh fetch run in parallel.

const $ = (id) => document.getElementById(id);
const COLORS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6"];
const marks = window.mdMarks ?? {};
let inOffice = false;
let view = null; // set by getActiveViewAsync
let live = false;
let socket = null;
let poll = null;
let reported = false;

const mark = (name) => {
  if (!(name in marks)) marks[name] = performance.now();
};

// Send load timings to the server terminal once (or after 8 s if stuck).
function report(force = false) {
  if (reported || (!force && !(marks.live && marks.drawn))) return;
  reported = true;
  const body = JSON.stringify({ pin: poll?.pin, view, marks });
  navigator.sendBeacon?.("/api/log", new Blob([body], { type: "application/json" }));
}
setTimeout(() => report(true), 8000);

function fitStage() {
  const scale = Math.min(innerWidth / 1600, innerHeight / 900);
  $("stage").style.setProperty("--scale", scale);
}
addEventListener("resize", fitStage);
fitStage();

function settings() {
  return Office.context.document.settings;
}

function saveSettings() {
  return new Promise((resolve, reject) => {
    settings().saveAsync((result) =>
      result.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(result.error),
    );
  });
}

function setStatus(text, cls = "") {
  $("status").textContent = text;
  $("status").className = `status ${cls}`;
}

function renderVotes(votes) {
  if (poll) poll.votes = votes;
  const total = Object.values(votes).reduce((sum, n) => sum + n, 0);
  $("total").textContent = total;
  for (const [key, count] of Object.entries(votes)) {
    const row = document.querySelector(`.row[data-key="${key}"]`);
    if (!row) continue;
    const pct = total ? Math.round((count / total) * 100) : 0;
    row.querySelector(".fill").style.width = `${pct}%`;
    row.querySelector(".value").innerHTML = `${pct}% <small>· ${count}</small>`;
  }
}

function renderPoll(next) {
  const sameShape = poll && JSON.stringify(poll.options) === JSON.stringify(next.options);
  poll = next;
  $("question").textContent = poll.question;
  $("pin").textContent = poll.pin;
  $("vote-url").textContent = poll.voteUrl.replace(/^https?:\/\//, "");
  // qrSvg comes from our own server and is cached in the deck.
  $("qr").innerHTML = poll.qrSvg ?? "";

  if (!sameShape) {
    const bars = $("bars");
    bars.replaceChildren();
    Object.entries(poll.options).forEach(([key, text], i) => {
      const row = document.createElement("div");
      row.className = "row";
      row.dataset.key = key;
      row.style.setProperty("--color", `var(${COLORS[i % COLORS.length]})`);
      row.innerHTML = `<span class="label"><span class="key"></span><span></span></span>
        <div class="track"><div class="fill"></div></div><span class="value"></span>`;
      row.querySelector(".key").textContent = key;
      row.querySelector(".label span:last-child").textContent = text;
      bars.append(row);
    });
  }
  renderVotes(poll.votes);
  $("poll").dataset.state = "ready";
  $("setup").hidden = true;
  $("poll").hidden = false;
}

async function fetchPoll(pin) {
  const res = await fetch(`/api/polls/${encodeURIComponent(pin)}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? "Poll not found");
  return body;
}

function connect(pin) {
  socket?.disconnect();
  socket = io({ transports: ["websocket"] });
  socket.on("connect", () => {
    mark("socketOpen");
    socket.emit("join", { pin, nickname: "slide-view" });
  });
  socket.on("joined", ({ votes }) => {
    mark("live");
    live = true;
    setStatus("Live", "live");
    if (poll) renderVotes(votes);
    report();
  });
  socket.on("vote_update", ({ votes }) => poll && renderVotes(votes));
  socket.on("error", ({ message }) => setStatus(message, "down"));
  socket.on("disconnect", () => setStatus("Reconnecting", "down"));
}

// Cache the poll in the deck so the next load can draw without the network.
// Only in edit view: saving during slideshow would mark the deck as changed.
async function cachePoll(fresh) {
  if (!inOffice || view !== "edit") return;
  const cached = settings().get("poll");
  if (JSON.stringify(cached) === JSON.stringify({ ...fresh, votes: cached?.votes })) return;
  settings().set("pin", fresh.pin);
  settings().set("poll", fresh);
  await saveSettings().catch(() => {});
}

async function show(pin, cached) {
  if (cached?.pin === pin) {
    renderPoll(cached);
    mark("drawnFromCache");
  }
  live = false;
  connect(pin);
  const fresh = await fetchPoll(pin);
  mark("fetched");
  // Socket counts win once joined; otherwise the fetch is newer than the cache.
  renderPoll({ ...fresh, votes: live && poll?.pin === pin ? poll.votes : fresh.votes });
  mark("drawn");
  report();
  await cachePoll(fresh);
}

function showSetup(message = "") {
  socket?.disconnect();
  $("poll").hidden = true;
  $("setup").hidden = false;
  $("setup-error").textContent = message;
  $("pin-input").focus();
}

// "read" is slideshow / reading view, "edit" is normal editing.
function applyView(next) {
  view = next;
  $("change").hidden = !inOffice || view === "read";
}

$("setup").addEventListener("submit", async (event) => {
  event.preventDefault();
  const pin = $("pin-input").value.trim();
  try {
    poll = null;
    await show(pin);
  } catch (err) {
    showSetup(err.message);
  }
});

$("change").addEventListener("click", async () => {
  if (inOffice) {
    settings().remove("pin");
    settings().remove("poll");
    await saveSettings().catch(() => {});
  }
  poll = null;
  showSetup();
});

Office.onReady(async (info) => {
  mark("officeReady");
  inOffice = Boolean(info.host);
  // In Office the PIN is stored per add-in instance in the deck, so it comes
  // back when the deck is reopened. In a browser tab it comes from ?pin=.
  const pin = inOffice ? settings().get("pin") : new URLSearchParams(location.search).get("pin");
  const cached = inOffice ? settings().get("poll") : null;

  if (inOffice) {
    Office.context.document.getActiveViewAsync((result) => applyView(result.value));
    Office.context.document.addHandlerAsync(Office.EventType.ActiveViewChanged, (event) =>
      applyView(event.activeView),
    );
  } else {
    applyView("read");
  }

  if (!pin) return showSetup();
  try {
    await show(pin, cached);
  } catch (err) {
    // Offline but cached: keep showing the cached poll.
    if (poll) setStatus("Offline", "down");
    else showSetup(err.message);
  }
});
