import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { IMPORT_MAX_BYTES, type ImportDetail, type ImportDto } from "@moddeck/shared";
import type { Response } from "express";
import { diskStorage } from "multer";
import { API_PREFIX } from "../auth/auth.config";
import { AuthGuard } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { ApiException } from "../common/api-error";
import { importsDir } from "./import-runner.service";
import { ImportsService } from "./imports.service";

// The upload goes to disk, not to memory: a PDF can be 50 MB.
const storage = diskStorage({
  destination: (_req, _file, done) => {
    const dir = importsDir();
    mkdirSync(dir, { recursive: true });
    done(null, dir);
  },
  filename: (_req, _file, done) => done(null, `${randomUUID()}.pdf`),
});

// PDF import (technical design §3.3). Every route is scoped to the deck's owner.
@Controller()
@UseGuards(AuthGuard)
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  // multipart/form-data with one `file` field. Answers once the PDF is read and the slides exist;
  // the pages fill in while the job runs.
  @Post("decks/:deckId/imports")
  @HttpCode(202)
  @UseInterceptors(FileInterceptor("file", { storage, limits: { fileSize: IMPORT_MAX_BYTES } }))
  async create(
    @CurrentUser() user: AuthUser,
    @Param("deckId") deckId: string,
    @UploadedFile() file: { path: string; originalname: string } | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ImportDto> {
    if (!file) {
      throw new ApiException(422, "INVALID_PAYLOAD", "Send the PDF in a `file` field", {
        field: "file",
        reason: "missing",
      });
    }
    const created = await this.imports.create(user.id, deckId, file);
    res.location(`/${API_PREFIX}/imports/${created.id}`);
    return created;
  }

  @Get("decks/:deckId/imports")
  list(@CurrentUser() user: AuthUser, @Param("deckId") deckId: string): Promise<ImportDto[]> {
    return this.imports.list(user.id, deckId);
  }

  @Get("imports/:importId")
  get(@CurrentUser() user: AuthUser, @Param("importId") importId: string): Promise<ImportDetail> {
    return this.imports.get(user.id, importId);
  }

  @Post("imports/:importId/retries")
  @HttpCode(202)
  retry(@CurrentUser() user: AuthUser, @Param("importId") importId: string): Promise<ImportDto> {
    return this.imports.retry(user.id, importId);
  }
}
