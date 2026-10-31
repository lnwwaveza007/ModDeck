// Undo and redo for the deck editor. One stack covers what the host did to a canvas (move, resize,
// type, style, add or remove an element) and to the deck (add, copy, delete or reorder a slide).
//
// A canvas change is a pair of element lists, before and after. A burst of changes to one slide
// (a drag sends one per pointer move, typing one per key) merges into a single entry, so one
// undo takes back the whole drag or the whole word. A slide change is a pair of async functions,
// because it has to ask the server.

import type { SlideElement } from "@moddeck/shared";

export interface ElementsEntry {
  type: "elements";
  /** The slide as it was first known, before any undo recreated it under a new id. */
  slide: string;
  before: SlideElement[];
  after: SlideElement[];
  at: number;
}

export interface CommandEntry {
  type: "command";
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export type Entry = ElementsEntry | CommandEntry;

export type ApplyElements = (slide: string, elements: SlideElement[]) => void;

/** Changes to the same slide closer together than this are one step. */
export const MERGE_WINDOW_MS = 500;
export const HISTORY_LIMIT = 100;

export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private grouping = true;
  private readonly listeners = new Set<() => void>();

  /** "10" when only undo is possible, "01" only redo, "11" both. For useSyncExternalStore. */
  get snapshot(): string {
    return `${this.undoStack.length > 0 ? 1 : 0}${this.redoStack.length > 0 ? 1 : 0}`;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Notes a canvas change. It joins the last entry when that is a quick change to the same slide
   * and nothing called `breakGroup` in between.
   */
  record(slide: string, before: SlideElement[], after: SlideElement[], now = Date.now()) {
    const last = this.undoStack[this.undoStack.length - 1];
    if (
      this.grouping &&
      last?.type === "elements" &&
      last.slide === slide &&
      now - last.at < MERGE_WINDOW_MS
    ) {
      last.after = after;
      last.at = now;
    } else {
      this.push({ type: "elements", slide, before, after, at: now });
    }
    this.grouping = true;
    // A burst that ends where it began changes nothing, so it leaves no step to undo.
    const top = this.undoStack[this.undoStack.length - 1];
    if (top?.type === "elements" && JSON.stringify(top.before) === JSON.stringify(top.after)) {
      this.undoStack.pop();
    }
    this.emit();
  }

  /** Notes a slide change that has already happened. */
  pushCommand(command: Omit<CommandEntry, "type">) {
    this.push({ type: "command", ...command });
    this.grouping = false;
    this.emit();
  }

  /** The next canvas change starts a new step, even if it is quick. */
  breakGroup() {
    this.grouping = false;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.grouping = false;
    this.emit();
  }

  /**
   * Takes back the last step. `applyElements` puts a list of elements back on a slide. A canvas
   * step is done before this returns; a slide step asks the server, so a promise comes back.
   * If a step fails it stays where it was, and the error goes to the caller.
   */
  undo(applyElements: ApplyElements): Promise<void> | void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    return this.run(
      entry,
      () => {
        if (entry.type === "elements") return applyElements(entry.slide, entry.before);
        return entry.undo();
      },
      this.redoStack,
      this.undoStack,
    );
  }

  redo(applyElements: ApplyElements): Promise<void> | void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    return this.run(
      entry,
      () => {
        if (entry.type === "elements") return applyElements(entry.slide, entry.after);
        return entry.redo();
      },
      this.undoStack,
      this.redoStack,
    );
  }

  // Runs one step. When it succeeds the entry moves to `to`; when it fails it goes back to `from`.
  private run(
    entry: Entry,
    step: () => Promise<void> | void,
    to: Entry[],
    from: Entry[],
  ): Promise<void> | void {
    this.grouping = false;
    this.emit();
    const done = () => {
      to.push(entry);
      this.emit();
    };
    const failed = (error: unknown) => {
      from.push(entry);
      this.emit();
      throw error;
    };
    let result: Promise<void> | void;
    try {
      result = step();
    } catch (error) {
      return failed(error);
    }
    if (!result) return done();
    return result.then(done, failed);
  }

  private push(entry: Entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    // Something new was done, so what was undone can no longer be redone.
    this.redoStack = [];
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}
