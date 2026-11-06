// Autosave for the deck editor (F8). Text edits wait for a short pause, then go out as one PATCH
// per slide. Structural changes (add, copy, delete, reorder, upload) go through `run`, which
// sends the waiting edits first and then the change, one request at a time, so the server
// sees them in the order the host made them.

export type SaveStatus = "saved" | "saving" | "error";

type Fields = Record<string, unknown>;
type Send = (fields: Fields) => Promise<unknown>;

export class SaveQueue {
  private readonly pending = new Map<string, { fields: Fields; send: Send }>();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private running = 0;
  private failed = false;

  constructor(private readonly delayMs = 800) {}

  get status(): SaveStatus {
    if (this.failed) return "error";
    return this.pending.size > 0 || this.running > 0 ? "saving" : "saved";
  }

  /** For useSyncExternalStore. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Keeps the newest value of each field per key and starts the pause timer again. */
  patch<F extends Fields>(key: string, fields: F, send: (fields: F) => Promise<unknown>) {
    const waiting = this.pending.get(key);
    this.pending.set(key, { fields: { ...waiting?.fields, ...fields }, send: send as Send });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
    this.notify();
  }

  /** Sends the waiting edits now. Resolves when the queue is empty again. */
  flush(): Promise<void> {
    return this.enqueue(() => this.sendPending());
  }

  /** `task` runs after every earlier edit and change. A rejection goes to the caller only. */
  run<T>(task: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      await this.sendPending();
      return task();
    });
  }

  /** After an error: tries the edits that did not go out again. */
  retry(): Promise<void> {
    this.failed = false;
    this.notify();
    return this.flush();
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.flush();
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running++;
    this.notify();
    const result = this.chain.then(job);
    this.chain = result.catch(() => undefined);
    return result.finally(() => {
      this.running--;
      this.notify();
    });
  }

  private async sendPending() {
    const batch = [...this.pending];
    this.pending.clear();
    let failed = false;
    for (const [slideId, { fields, send }] of batch) {
      try {
        await send(fields);
      } catch {
        failed = true;
        // Keep the edit for retry, unless the host has typed something newer since.
        const newer = this.pending.get(slideId);
        this.pending.set(slideId, { fields: { ...fields, ...newer?.fields }, send });
      }
    }
    this.failed = failed;
    this.notify();
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}
