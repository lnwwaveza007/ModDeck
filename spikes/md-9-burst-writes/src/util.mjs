export function pct(values, p) {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

export const ms = (x) => `${x.toFixed(2)} ms`;

export function summary(values) {
  return {
    p50: ms(pct(values, 50)),
    p95: ms(pct(values, 95)),
    p99: ms(pct(values, 99)),
    max: ms(Math.max(...values)),
  };
}

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function args(defaults) {
  const out = { ...defaults };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([\w-]+)$/);
    if (!m) continue;
    const key = m[1];
    const val = argv[i + 1];
    out[key] = typeof defaults[key] === "number" ? Number(val) : val;
    i++;
  }
  return out;
}

export const sleep = (t) => new Promise((r) => setTimeout(r, t));
