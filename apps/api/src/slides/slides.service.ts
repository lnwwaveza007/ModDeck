import { Injectable } from "@nestjs/common";
import {
  DECK_SLIDES_MAX,
  isActivityKind,
  type SlideCreateBody,
  type SlideDto,
  type SlideElement,
} from "@moddeck/shared";
import { z } from "zod";
import { ApiException } from "../common/api-error";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { slideArgs, toSlideDto } from "./slide.mapper";

const uuid = z.uuid();

// Another host's deck, a deleted deck, a slide of another deck and a malformed id all answer
// the same 404, so a host cannot tell which ids exist.
const deckNotFound = () => new ApiException(404, "NOT_FOUND", "Deck not found");
const slideNotFound = () => new ApiException(404, "NOT_FOUND", "Slide not found");

function invalid(field: string, reason: string, message: string) {
  return new ApiException(422, "INVALID_PAYLOAD", message, { field, reason });
}

const deckFull = () =>
  invalid("slides", "deck_full", `A deck holds at most ${DECK_SLIDES_MAX} slides`);

// The elements column is JSON, so Prisma wants a plain JSON value.
const toJson = (elements: SlideElement[]): Prisma.InputJsonValue =>
  elements as unknown as Prisma.InputJsonValue;

/** Slide rules of the deck editor: positions stay 0..n-1 with no gaps after every change. */
@Injectable()
export class SlidesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, deckId: string, body: SlideCreateBody): Promise<SlideDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.requireDeck(tx, ownerId, deckId);
      if (body.elements && isActivityKind(body.kind)) {
        throw invalid("elements", "not_content", "Only a content slide has elements");
      }
      const count = await tx.slide.count({ where: { deckId } });
      if (count >= DECK_SLIDES_MAX) throw deckFull();

      const position = Math.min(body.position ?? count, count);
      await tx.slide.updateMany({
        where: { deckId, position: { gte: position } },
        data: { position: { increment: 1 } },
      });
      const slide = await tx.slide.create({
        data: {
          deckId,
          position,
          kind: body.kind,
          elements: toJson(body.elements ?? []),
          // The wording and options are written by the activity editors (R1-13, R1-16).
          ...(isActivityKind(body.kind) && {
            activity: { create: { type: body.kind, prompt: "" } },
          }),
        },
        ...slideArgs,
      });
      await this.touchDeck(tx, deckId);
      return toSlideDto(slide);
    });
  }

  /** Replaces the canvas of a content slide with the given elements, back to front. */
  async updateElements(
    ownerId: string,
    deckId: string,
    slideId: string,
    elements: SlideElement[],
  ): Promise<SlideDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.requireDeck(tx, ownerId, deckId);
      const slide = await this.requireSlide(tx, deckId, slideId);
      if (isActivityKind(toKind(slide.kind))) {
        throw invalid("elements", "not_content", "Only a content slide has elements");
      }
      const updated = await tx.slide.update({
        where: { id: slideId },
        data: { elements: toJson(elements) },
        ...slideArgs,
      });
      await this.touchDeck(tx, deckId);
      return toSlideDto(updated);
    });
  }

  async remove(ownerId: string, deckId: string, slideId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.requireDeck(tx, ownerId, deckId);
      const slide = await this.requireSlide(tx, deckId, slideId);
      if (isActivityKind(toKind(slide.kind))) await this.requireNotLive(tx, slideId);
      await tx.slide.delete({ where: { id: slideId } });
      await tx.slide.updateMany({
        where: { deckId, position: { gt: slide.position } },
        data: { position: { decrement: 1 } },
      });
      await this.touchDeck(tx, deckId);
    });
  }

  /** The copy sits right after the original. An activity copy starts without runs or answers. */
  async duplicate(ownerId: string, deckId: string, slideId: string): Promise<SlideDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.requireDeck(tx, ownerId, deckId);
      if (!uuid.safeParse(slideId).success) throw slideNotFound();
      const source = await tx.slide.findFirst({
        where: { id: slideId, deckId },
        include: { activity: { include: { options: { orderBy: { position: "asc" } } } } },
      });
      if (!source) throw slideNotFound();
      if ((await tx.slide.count({ where: { deckId } })) >= DECK_SLIDES_MAX) throw deckFull();

      const position = source.position + 1;
      await tx.slide.updateMany({
        where: { deckId, position: { gte: position } },
        data: { position: { increment: 1 } },
      });
      const { activity } = source;
      const copy = await tx.slide.create({
        data: {
          deckId,
          position,
          kind: source.kind,
          // Image files are never edited in place, so both slides can share them.
          elements: source.elements as Prisma.InputJsonValue,
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
        },
        ...slideArgs,
      });
      await this.touchDeck(tx, deckId);
      return toSlideDto(copy);
    });
  }

  /** PUT /slide-order: `slideIds` must be exactly the deck's slides, each once. */
  async reorder(ownerId: string, deckId: string, slideIds: string[]): Promise<SlideDto[]> {
    return this.prisma.$transaction(async (tx) => {
      await this.requireDeck(tx, ownerId, deckId);
      const current = await tx.slide.findMany({ where: { deckId }, select: { id: true } });
      const known = new Set(current.map((slide) => slide.id));
      const matches =
        slideIds.length === known.size &&
        new Set(slideIds).size === slideIds.length &&
        slideIds.every((id) => known.has(id));
      if (!matches) {
        throw invalid("slideIds", "mismatch", "slideIds must list every slide of the deck once");
      }
      for (const [position, id] of slideIds.entries()) {
        await tx.slide.update({ where: { id }, data: { position }, select: { id: true } });
      }
      await this.touchDeck(tx, deckId);
      const slides = await tx.slide.findMany({
        where: { deckId },
        orderBy: { position: "asc" },
        ...slideArgs,
      });
      return slides.map(toSlideDto);
    });
  }

  /** Throws unless the deck is the host's own. Runs before an image file is written. */
  async assertDeckOwner(ownerId: string, deckId: string): Promise<void> {
    await this.prisma.$transaction((tx) => this.requireDeck(tx, ownerId, deckId));
  }

  /** A live run on the activity keeps its slide in place (technical design §3.3). */
  private async requireNotLive(tx: Prisma.TransactionClient, slideId: string) {
    const live = await tx.activityRun.count({
      where: { activity: { slideId }, state: "live", session: { status: { not: "ended" } } },
    });
    if (live > 0) {
      throw new ApiException(409, "ACTIVITY_LOCKED", "This activity is live in a session");
    }
  }

  private async requireDeck(tx: Prisma.TransactionClient, ownerId: string, deckId: string) {
    if (!uuid.safeParse(deckId).success) throw deckNotFound();
    const deck = await tx.deck.findFirst({
      where: { id: deckId, ownerId, deletedAt: null },
      select: { id: true },
    });
    if (!deck) throw deckNotFound();
  }

  private async requireSlide(tx: Prisma.TransactionClient, deckId: string, slideId: string) {
    if (!uuid.safeParse(slideId).success) throw slideNotFound();
    const slide = await tx.slide.findFirst({ where: { id: slideId, deckId } });
    if (!slide) throw slideNotFound();
    return slide;
  }

  // "My decks" sorts by updatedAt, so a slide edit counts as a deck edit.
  private touchDeck(tx: Prisma.TransactionClient, deckId: string) {
    return tx.deck.update({
      where: { id: deckId },
      data: { updatedAt: new Date() },
      select: { id: true },
    });
  }
}

// Rows from before the canvas editor can still hold text, code, math or image.
function toKind(kind: string): "content" | "poll" | "word_cloud" {
  return kind === "poll" || kind === "word_cloud" ? kind : "content";
}
