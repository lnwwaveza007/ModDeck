import { randomUUID } from "node:crypto";
import { open, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import {
  DECK_SLIDES_MAX,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_PAGES,
  type ImportDetail,
  type ImportDto,
  type ImportErrorCode,
} from "@moddeck/shared";
import { z } from "zod";
import { ApiException } from "../common/api-error";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ImportRunnerService, importsDir } from "./import-runner.service";
import { probePdf } from "./worker-host";

const uuid = z.uuid();

const deckNotFound = () => new ApiException(404, "NOT_FOUND", "Deck not found");
const importNotFound = () => new ApiException(404, "NOT_FOUND", "Import not found");

function invalid(reason: string, message: string, status = 422) {
  return new ApiException(status, "INVALID_PAYLOAD", message, { field: "file", reason });
}

const importArgs = {
  include: {
    pages: {
      orderBy: { page: "asc" },
      select: { page: true, slideId: true, status: true, errorCode: true },
    },
  },
} satisfies Prisma.PdfImportDefaultArgs;
type ImportRow = Prisma.PdfImportGetPayload<typeof importArgs>;

const asCode = (code: string | null) => code as ImportErrorCode | null;

function toImportDto(row: ImportRow): ImportDto {
  return {
    id: row.id,
    deckId: row.deckId,
    fileName: row.fileName,
    status: row.status,
    pageCount: row.pageCount ?? row.pages.length,
    donePages: row.pages.filter((p) => p.status === "done").length,
    failedPages: row.pages.filter((p) => p.status === "failed").length,
    errorCode: asCode(row.errorCode),
    createdAt: row.createdAt.toISOString(),
  };
}

function toImportDetail(row: ImportRow): ImportDetail {
  return {
    ...toImportDto(row),
    pages: row.pages.map((p) => ({
      page: p.page,
      slideId: p.slideId,
      status: p.status,
      errorCode: asCode(p.errorCode),
    })),
  };
}

export interface UploadedPdf {
  /** Where multer wrote the upload, inside the imports folder. */
  path: string;
  originalname: string;
}

// A PDF starts with "%PDF-", though some tools put a few bytes in front of it.
async function looksLikePdf(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(1024), 0, 1024, 0);
    return buffer.subarray(0, bytesRead).includes("%PDF-");
  } finally {
    await handle.close();
  }
}

/** PDF import (F9): the upload, the job's state and the retry. The work itself is the runner's. */
@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: ImportRunnerService,
  ) {}

  /**
   * Checks the upload and adds one empty slide per page at the end of the deck. The runner fills
   * the slides in. The file is removed again if anything fails.
   */
  async create(ownerId: string, deckId: string, file: UploadedPdf): Promise<ImportDto> {
    const fileRef = file.path.slice(
      file.path.lastIndexOf(file.path.includes("\\") ? "\\" : "/") + 1,
    );
    try {
      await this.requireDeck(ownerId, deckId);
      const size = (await stat(file.path)).size;
      if (size === 0) throw invalid("empty", "The file is empty");
      if (size > IMPORT_MAX_BYTES) throw invalid("too_large", "PDF is larger than 50 MB", 413);
      if (!(await looksLikePdf(file.path))) throw invalid("not_pdf", "The file is not a PDF", 415);
      const running = await this.prisma.pdfImport.count({
        where: { deckId, status: { in: ["queued", "running"] } },
      });
      if (running) throw new ApiException(409, "IMPORT_RUNNING", "A PDF import is still running");

      const probe = await probePdf(file.path);
      if (!probe.ok) {
        throw probe.code === "PDF_PROTECTED"
          ? invalid("protected", "The PDF is password protected")
          : invalid("corrupt", "The PDF cannot be read");
      }
      const { pageCount } = probe;
      if (pageCount < 1) throw invalid("corrupt", "The PDF has no pages");
      if (pageCount > IMPORT_MAX_PAGES) {
        throw invalid("too_many_pages", `A PDF can have at most ${IMPORT_MAX_PAGES} pages`);
      }

      const row = await this.prisma.$transaction(async (tx) => {
        const count = await tx.slide.count({ where: { deckId } });
        if (count + pageCount > DECK_SLIDES_MAX) {
          throw invalid("deck_full", `A deck holds at most ${DECK_SLIDES_MAX} slides`);
        }
        const created = await tx.pdfImport.create({
          data: { deckId, fileName: file.originalname.slice(0, 200), fileRef, pageCount },
          select: { id: true },
        });
        const slideIds = Array.from({ length: pageCount }, () => randomUUID());
        await tx.slide.createMany({
          data: slideIds.map((id, i) => ({
            id,
            deckId,
            position: count + i,
            kind: "content" as const,
          })),
        });
        await tx.pdfImportPage.createMany({
          data: slideIds.map((slideId, i) => ({ importId: created.id, page: i + 1, slideId })),
        });
        await tx.deck.update({
          where: { id: deckId },
          data: { updatedAt: new Date() },
          select: { id: true },
        });
        return tx.pdfImport.findUniqueOrThrow({ where: { id: created.id }, ...importArgs });
      });
      this.runner.kick();
      return toImportDto(row);
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      throw error;
    }
  }

  /** The newest imports of a deck, so the editor can pick up an import that is still running. */
  async list(ownerId: string, deckId: string): Promise<ImportDto[]> {
    await this.requireDeck(ownerId, deckId);
    const rows = await this.prisma.pdfImport.findMany({
      where: { deckId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
      ...importArgs,
    });
    return rows.map(toImportDto);
  }

  async get(ownerId: string, importId: string): Promise<ImportDetail> {
    return toImportDetail(await this.requireImport(ownerId, importId));
  }

  /** POST /imports/{id}/retries: the pages that failed go through the queue again. */
  async retry(ownerId: string, importId: string): Promise<ImportDto> {
    const current = await this.requireImport(ownerId, importId);
    if (current.status === "queued" || current.status === "running") {
      throw new ApiException(409, "IMPORT_RUNNING", "The import is still running");
    }
    const failed = current.pages.filter((p) => p.status === "failed");
    if (!failed.length) throw invalid("nothing_to_retry", "No page failed");
    const kept =
      current.fileRef && (await stat(join(importsDir(), current.fileRef)).catch(() => null));
    if (!kept) {
      throw invalid("file_expired", "The PDF is no longer kept: upload it again");
    }
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.pdfImportPage.updateMany({
        where: { importId, status: "failed" },
        data: { status: "queued", errorCode: null, attempts: 0 },
      });
      await tx.pdfImport.update({
        where: { id: importId },
        data: { status: "queued", errorCode: null },
        select: { id: true },
      });
      return tx.pdfImport.findUniqueOrThrow({ where: { id: importId }, ...importArgs });
    });
    this.runner.kick();
    return toImportDto(row);
  }

  private async requireDeck(ownerId: string, deckId: string) {
    if (!uuid.safeParse(deckId).success) throw deckNotFound();
    const deck = await this.prisma.deck.findFirst({
      where: { id: deckId, ownerId, deletedAt: null },
      select: { id: true },
    });
    if (!deck) throw deckNotFound();
  }

  private async requireImport(ownerId: string, importId: string) {
    if (!uuid.safeParse(importId).success) throw importNotFound();
    const row = await this.prisma.pdfImport.findFirst({
      where: { id: importId, deck: { ownerId, deletedAt: null } },
      ...importArgs,
    });
    if (!row) throw importNotFound();
    return row;
  }
}
