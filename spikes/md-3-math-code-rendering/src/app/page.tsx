import { LabClient } from "./lab-client";
import { pythonLineCount } from "../lib/fixtures";

export default function Page() {
  return (
    <main className="page">
      <header className="hero">
        <h1>MD-3 spike · Math and code rendering</h1>
        <p className="lede">
          This page proves that a Next.js client can render classroom LaTeX with KaTeX and
          programming samples with both Shiki and PrismJS after the content arrives as a WebSocket
          JSON payload. The Python sample is {pythonLineCount()} lines.
        </p>
      </header>
      <LabClient />
    </main>
  );
}
