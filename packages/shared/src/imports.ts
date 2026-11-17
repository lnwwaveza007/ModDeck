// PDF import (F9, technical design §3.3). The host uploads a lecture PDF; each page becomes one
// content slide with a full-canvas image. A background job fills the slides in page by page.

export const IMPORT_MAX_BYTES = 50 * 1024 * 1024;
export const IMPORT_MAX_PAGES = 150;

export type ImportStatus = "queued" | "running" | "done" | "failed";
export type ImportPageStatus = "queued" | "running" | "done" | "failed";

// Why an import or a page failed. The frontend maps each code to Thai / English text.
export const IMPORT_ERROR_CODES = [
  "PDF_INVALID", // not a readable PDF
  "PDF_PROTECTED", // needs a password
  "PAGE_RENDER_FAILED", // pdf.js could not draw this page
  "PAGE_TIMEOUT", // one page took too long
  "WORKER_CRASH", // the import worker stopped while on this page
  "ALL_PAGES_FAILED",
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

/** One import as the editor shows it. Times are ISO 8601 UTC. */
export interface ImportDto {
  id: string;
  deckId: string;
  fileName: string;
  status: ImportStatus;
  // Known once the PDF is read: the upload answers only after that.
  pageCount: number;
  donePages: number;
  failedPages: number;
  // Set when the whole import failed.
  errorCode: ImportErrorCode | null;
  createdAt: string;
}

export interface ImportPageDto {
  page: number;
  slideId: string;
  status: ImportPageStatus;
  errorCode: ImportErrorCode | null;
}

/** GET /imports/{importId}: the import plus the state of each page. */
export interface ImportDetail extends ImportDto {
  pages: ImportPageDto[];
}

/** On a slide that an import has not filled in yet, or could not. */
export type SlideImportStatus = "pending" | "failed";
