import { Injectable } from "@nestjs/common";
import { DECK_TITLE_MAX, type DeckSummary } from "@moddeck/shared";
import { z } from "zod";
import { ApiException } from "../common/api-error";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const summaryArgs = {
  include: {
    _count: { select: { slides: true, sessions: true } },
    sessions: {
      where: { status: { not: "ended" } },
      select: { id: true, pin: true },
      orderBy: { startedAt: "asc" },
    },
  },
} satisfies Prisma.DeckDefaultArgs;

type DeckWithCounts = Prisma.DeckGetPayload<typeof summaryArgs>;

const uuid = z.uuid();

function toSummary(deck: DeckWithCounts): DeckSummary {
  return {
    id: deck.id,
    title: deck.title,
    slideCount: deck._count.slides,
    sessionCount: deck._count.sessions,
    liveSessions: deck.sessions,
    createdAt: deck.createdAt.toISOString(),
    updatedAt: deck.updatedAt.toISOString(),
  };
}

// Another host's deck, a deleted deck and a malformed id all answer the same
// 404, so a host cannot tell which deck ids exist.
const notFound = () => new ApiException(404, "NOT_FOUND", "Deck not found");

@Injectable()
export class DecksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string): Promise<DeckSummary[]> {
    const decks = await this.prisma.deck.findMany({
      where: { ownerId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      ...summaryArgs,
    });
    return decks.map(toSummary);
  }

  async get(ownerId: string, deckId: string): Promise<DeckSummary> {
    return toSummary(await this.findOwned(this.prisma, ownerId, deckId));
  }

  /** A new deck starts with one blank title slide (technical design §3.3). */
  async create(ownerId: string, title: string): Promise<DeckSummary> {
    const deck = await this.prisma.deck.create({
      data: { ownerId, title, slides: { create: { position: 0, kind: "text" } } },
      ...summaryArgs,
    });
    return toSummary(deck);
  }

  async rename(ownerId: string, deckId: string, title: string): Promise<DeckSummary> {
    await this.findOwned(this.prisma, ownerId, deckId);
    const deck = await this.prisma.deck.update({
      where: { id: deckId },
      data: { title },
      ...summaryArgs,
    });
    return toSummary(deck);
  }

  /** Copies the settings, slides, activities and options. Sessions stay with the original. */
  async duplicate(ownerId: string, deckId: string, title?: string): Promise<DeckSummary> {
    return this.prisma.$transaction(async (tx) => {
      await this.findOwned(tx, ownerId, deckId);
      const source = await tx.deck.findUniqueOrThrow({
        where: { id: deckId },
        include: {
          slides: {
            orderBy: { position: "asc" },
            include: { activity: { include: { options: { orderBy: { position: "asc" } } } } },
          },
        },
      });
      const copy = await tx.deck.create({
        data: {
          ownerId,
          title: title ?? `${source.title} (copy)`.slice(0, DECK_TITLE_MAX),
          requireKmuttLogin: source.requireKmuttLogin,
          qaEnabled: source.qaEnabled,
          anonymousAllowed: source.anonymousAllowed,
          showResultsLive: source.showResultsLive,
          autoStart: source.autoStart,
          reactionsEnabled: source.reactionsEnabled,
          slides: {
            // Image files are never edited in place, so both decks can share imageRef.
            create: source.slides.map(({ position, kind, content, imageRef, activity }) => ({
              position,
              kind,
              content,
              imageRef,
              ...(activity && {
                activity: {
                  create: {
                    type: activity.type,
                    prompt: activity.prompt,
                    multipleChoice: activity.multipleChoice,
                    allowAnswerChange: activity.allowAnswerChange,
                    maxEntriesPerPerson: activity.maxEntriesPerPerson,
                    options: {
                      create: activity.options.map(({ position, label }) => ({ position, label })),
                    },
                  },
                },
              }),
            })),
          },
        },
        ...summaryArgs,
      });
      return toSummary(copy);
    });
  }

  /**
   * Soft delete: the deck leaves My decks, but its past sessions and results stay for
   * session history and export. Refused while a session on it is still running.
   */
  async remove(ownerId: string, deckId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const deck = await this.findOwned(tx, ownerId, deckId);
      if (deck.sessions.length > 0) {
        throw new ApiException(409, "DECK_LIVE", "A session on this deck is still live", {
          liveSessions: deck.sessions.length,
        });
      }
      await tx.deck.update({ where: { id: deckId }, data: { deletedAt: new Date() } });
    });
  }

  private async findOwned(
    db: Prisma.TransactionClient,
    ownerId: string,
    deckId: string,
  ): Promise<DeckWithCounts> {
    if (!uuid.safeParse(deckId).success) throw notFound();
    const deck = await db.deck.findFirst({
      where: { id: deckId, ownerId, deletedAt: null },
      ...summaryArgs,
    });
    if (!deck) throw notFound();
    return deck;
  }
}
