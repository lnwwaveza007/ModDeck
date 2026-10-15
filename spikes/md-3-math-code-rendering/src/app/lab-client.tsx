"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HighlighterGeneric } from "shiki";
import { buildSlidePayload, pythonLineCount, type SlidePayload } from "../lib/fixtures";
import { measureMs, renderKatex, renderPrism, renderShiki } from "../lib/render";

type View = "projector" | "phone";
type HighlighterChoice = "shiki" | "prism";

type Metrics = {
  katexMs: number | null;
  shikiMs: number | null;
  prismMs: number | null;
  shikiInitMs: number | null;
  pythonLines: number;
};

const EMPTY_METRICS: Metrics = {
  katexMs: null,
  shikiMs: null,
  prismMs: null,
  shikiInitMs: null,
  pythonLines: pythonLineCount(),
};

function defaultWsUrl(): string {
  if (typeof window === "undefined") {
    return "ws://localhost:4010";
  }
  const host = window.location.hostname;
  return `ws://${host}:4010`;
}

export function LabClient() {
  const [wsUrl, setWsUrl] = useState("ws://localhost:4010");
  const [status, setStatus] = useState("Disconnected");
  const [clients, setClients] = useState(0);
  const [view, setView] = useState<View>("projector");
  const [engine, setEngine] = useState<HighlighterChoice>("shiki");
  const [payload, setPayload] = useState<SlidePayload | null>(null);
  const [mathHtml, setMathHtml] = useState<string[]>([]);
  const [codeHtml, setCodeHtml] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const highlighterRef = useRef<HighlighterGeneric<string, string> | null>(null);
  const prismRef = useRef<typeof import("prismjs") | null>(null);
  const engineRef = useRef(engine);
  engineRef.current = engine;

  useEffect(() => {
    setWsUrl(defaultWsUrl());
  }, []);

  const ensurePrism = useCallback(async () => {
    if (prismRef.current) {
      return prismRef.current;
    }
    const prismModule = await import("prismjs");
    const Prism = prismModule.default ?? prismModule;
    await import("prismjs/components/prism-python");
    await import("prismjs/components/prism-java");
    await import("prismjs/components/prism-sql");
    prismRef.current = Prism;
    return Prism;
  }, []);

  const ensureShiki = useCallback(async () => {
    if (highlighterRef.current) {
      return highlighterRef.current;
    }
    const start = performance.now();
    const { createHighlighter } = await import("shiki");
    const highlighter = await createHighlighter({
      themes: ["github-light"],
      langs: ["python", "java", "sql"],
    });
    highlighterRef.current = highlighter;
    setMetrics((current) => ({
      ...current,
      shikiInitMs: Math.round((performance.now() - start) * 10) / 10,
    }));
    return highlighter;
  }, []);

  const renderPayload = useCallback(
    async (next: SlidePayload, choice: HighlighterChoice) => {
      setError(null);
      setPayload(next);

      const mathMs = await measureMs(() => {
        const html = next.math.map((block) => renderKatex(block.latex));
        setMathHtml(html);
      });

      let shikiMs: number | null = null;
      let prismMs: number | null = null;
      const python = next.code.find((block) => block.lang === "python");

      if (choice === "shiki") {
        const highlighter = await ensureShiki();
        shikiMs = await measureMs(() => {
          setCodeHtml(next.code.map((block) => renderShiki(highlighter, block.source, block.lang)));
        });
      } else {
        const prism = await ensurePrism();
        prismMs = await measureMs(() => {
          setCodeHtml(next.code.map((block) => renderPrism(block.source, block.lang, prism)));
        });
      }

      setMetrics((current) => ({
        ...current,
        katexMs: mathMs,
        shikiMs: choice === "shiki" ? shikiMs : current.shikiMs,
        prismMs: choice === "prism" ? prismMs : current.prismMs,
        pythonLines: python ? python.source.trim().split("\n").length : current.pythonLines,
      }));
    },
    [ensurePrism, ensureShiki],
  );

  const onMessage = useCallback(
    (event: MessageEvent<string>) => {
      try {
        const message = JSON.parse(event.data) as { type?: string; clients?: number } & Partial<SlidePayload>;
        if (message.type === "hello" || message.type === "presence" || message.type === "ack") {
          if (typeof message.clients === "number") {
            setClients(message.clients);
          }
          return;
        }
        if (message.type === "slide") {
          void renderPayload(message as SlidePayload, engineRef.current);
        }
      } catch (err) {
        setError(String(err));
      }
    },
    [renderPayload],
  );

  const connect = useCallback(() => {
    socketRef.current?.close();
    setStatus("Connecting…");
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;
    socket.addEventListener("open", () => setStatus("Connected"));
    socket.addEventListener("close", () => setStatus("Disconnected"));
    socket.addEventListener("error", () => {
      setStatus("Error");
      setError("WebSocket failed. Start the mock server: pnpm --filter spike-md-3-math-code-rendering start:ws");
    });
    socket.addEventListener("message", onMessage);
  }, [onMessage, wsUrl]);

  useEffect(() => {
    return () => socketRef.current?.close();
  }, []);

  const sendLocal = useCallback(() => {
    void renderPayload(buildSlidePayload(), engine);
  }, [engine, renderPayload]);

  const sendSocket = useCallback(() => {
    const next = buildSlidePayload();
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("Connect to the WebSocket server first, then press Send via WebSocket.");
      return;
    }
    socket.send(JSON.stringify(next));
    void renderPayload(next, engine);
  }, [engine, renderPayload]);

  useEffect(() => {
    if (payload) {
      void renderPayload(payload, engine);
    }
    // Re-highlight when the teammate switches Shiki/Prism. Payload identity is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  const connected = status === "Connected";
  const statusClass = connected ? "ok" : status === "Error" ? "warn" : "";

  const checklist = useMemo(
    () => [
      `KaTeX drew ${payload?.math.length ?? 0} formulas (need 5).`,
      `Python block is ${metrics.pythonLines} lines (need 50+).`,
      payload ? "Content was applied through the same render path used for the WebSocket payload." : "No payload yet.",
    ],
    [metrics.pythonLines, payload],
  );

  return (
    <>
      <section className="panel">
        <div className="row">
          <label htmlFor="ws-url">WebSocket URL</label>
          <input
            id="ws-url"
            type="text"
            value={wsUrl}
            onChange={(event) => setWsUrl(event.target.value)}
            spellCheck={false}
          />
          <button type="button" onClick={connect}>
            Connect
          </button>
          <button type="button" className="primary" onClick={sendSocket}>
            Send via WebSocket
          </button>
          <button type="button" onClick={sendLocal}>
            Render locally (no socket)
          </button>
        </div>
        <p className={`status ${statusClass}`}>
          {status}
          {connected ? ` · ${clients} client${clients === 1 ? "" : "s"}` : ""}
        </p>
        {error ? <p className="status warn">{error}</p> : null}

        <div className="row" style={{ marginTop: 12 }}>
          <span>Screen</span>
          <button type="button" className="tab" aria-pressed={view === "projector"} onClick={() => setView("projector")}>
            Projector
          </button>
          <button type="button" className="tab" aria-pressed={view === "phone"} onClick={() => setView("phone")}>
            Student phone
          </button>
          <span>Code engine</span>
          <button type="button" className="tab" aria-pressed={engine === "shiki"} onClick={() => setEngine("shiki")}>
            Shiki
          </button>
          <button type="button" className="tab" aria-pressed={engine === "prism"} onClick={() => setEngine("prism")}>
            PrismJS
          </button>
        </div>

        <div className="metrics">
          <div className="metric">
            <span>KaTeX</span>
            <b>{fmtMs(metrics.katexMs)}</b>
          </div>
          <div className="metric">
            <span>Shiki highlight</span>
            <b>{fmtMs(metrics.shikiMs)}</b>
          </div>
          <div className="metric">
            <span>PrismJS highlight</span>
            <b>{fmtMs(metrics.prismMs)}</b>
          </div>
          <div className="metric">
            <span>Shiki first init</span>
            <b>{fmtMs(metrics.shikiInitMs)}</b>
          </div>
        </div>
        <ul className="checklist">
          {checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className={`stage ${view}`} aria-label={`${view} preview`}>
        {!payload ? (
          <p className="empty">Nothing rendered yet. Press “Render locally” or connect and send the payload.</p>
        ) : (
          <>
            <p className="note">
              {payload.title} · {view} · {engine} · received {payload.sentAt}
            </p>
            {payload.math.map((block, index) => (
              <article className="block" key={block.id}>
                <h2>{block.label}</h2>
                <div className="math" dangerouslySetInnerHTML={{ __html: mathHtml[index] ?? "" }} />
              </article>
            ))}
            {payload.code.map((block, index) => (
              <article className="block" key={block.id}>
                <h2>
                  {block.label} · {engine}
                </h2>
                {engine === "shiki" ? (
                  <div dangerouslySetInnerHTML={{ __html: codeHtml[index] ?? "" }} />
                ) : (
                  <pre className={`language-${block.lang}`}>
                    <code
                      className={`language-${block.lang}`}
                      dangerouslySetInnerHTML={{ __html: codeHtml[index] ?? "" }}
                    />
                  </pre>
                )}
              </article>
            ))}
          </>
        )}
      </section>
      <p className="note">
        From a phone on the same Wi-Fi, open this page using the laptop LAN IP (not localhost), connect to{" "}
        <code>ws://&lt;lan-ip&gt;:4010</code>, then send the payload from any connected tab.
      </p>
    </>
  );
}

function fmtMs(value: number | null): string {
  return value == null ? "—" : `${value} ms`;
}
