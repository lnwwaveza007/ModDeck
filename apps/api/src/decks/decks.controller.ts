import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  deckCopyBodySchema,
  deckTitleBodySchema,
  type DeckCopyBody,
  type DeckDetail,
  type DeckSummary,
  type DeckTitleBody,
} from "@moddeck/shared";
import type { Response } from "express";
import { API_PREFIX } from "../auth/auth.config";
import { AuthGuard } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { ZodBody } from "../common/api-error";
import { DecksService } from "./decks.service";

// My decks (technical design §3.3). Every route is scoped to the logged-in host.
@Controller("decks")
@UseGuards(AuthGuard)
export class DecksController {
  constructor(private readonly decks: DecksService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<DeckSummary[]> {
    return this.decks.list(user.id);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(deckTitleBodySchema)) body: DeckTitleBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DeckSummary> {
    const deck = await this.decks.create(user.id, body.title);
    res.location(`/${API_PREFIX}/decks/${deck.id}`);
    return deck;
  }

  @Get(":deckId")
  get(@CurrentUser() user: AuthUser, @Param("deckId") deckId: string): Promise<DeckDetail> {
    return this.decks.get(user.id, deckId);
  }

  @Patch(":deckId")
  rename(
    @CurrentUser() user: AuthUser,
    @Param("deckId") deckId: string,
    @Body(new ZodBody(deckTitleBodySchema)) body: DeckTitleBody,
  ): Promise<DeckSummary> {
    return this.decks.rename(user.id, deckId, body.title);
  }

  @Delete(":deckId")
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param("deckId") deckId: string): Promise<void> {
    return this.decks.remove(user.id, deckId);
  }

  @Post(":deckId/copies")
  async duplicate(
    @CurrentUser() user: AuthUser,
    @Param("deckId") deckId: string,
    @Body(new ZodBody(deckCopyBodySchema)) body: DeckCopyBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DeckSummary> {
    const deck = await this.decks.duplicate(user.id, deckId, body?.title);
    res.location(`/${API_PREFIX}/decks/${deck.id}`);
    return deck;
  }
}
