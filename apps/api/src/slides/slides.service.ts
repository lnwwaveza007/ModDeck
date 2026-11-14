import { Injectable } from "@nestjs/common";
import {
  DECK_SLIDES_MAX,
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  isActivityKind,
  type ActivityWordingBody,
  type LiveActivity,
  type SlideCreateBody,
  type SlideDto,
  type SlideElement,
} from "@moddeck/shared";
import { z } from "zod";
import { ApiException } from "../common/api-error";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RoomEventsService } from "../realtime/room-events.service";
import { liveActivitySelect, slideArgs, toLiveActivity, toSlideDto } from "./slide.mapper";

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: RoomEventsService,
  ) {}

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
      if (isActivityKind(toKind(slide.kind))) await this.requireNoOpenSession(tx, deckId);
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

  /**
   * The wording of a poll or word cloud. While the activity has started in a session that is
   * still open, only the wording can change: the same options in the same order, so answers
   * already given still point at what the students chose, and the same limit of words per
   * student, so no student has sent more than the limit allows. Open sessions of the deck get the
   * new wording at once (activity_edited).
   */
  async updateActivity(
    ownerId: string,
    deckId: string,
    slideId: string,
    body: ActivityWordingBody,
  ): Promise<LiveActivity> {
    const { activity, sessionIds } = await this.prisma.$transaction(async (tx) => {
      await this.requireDeck(tx, ownerId, deckId);
      const slide = await this.requireSlide(tx, deckId, slideId);
      const current = await tx.activity.findUnique({
        where: { slideId: slide.id },
        include: { options: { orderBy: { position: "asc" } } },
      });
      if (!current) throw invalid("activity", "not_activity", "Only an activity slide has wording");

      const options = body.options;
      if (current.type === "word_cloud" && options?.length) {
        throw invalid("options", "not_poll", "A word cloud has no options");
      }
      const { maxEntries } = body;
      if (maxEntries !== undefined) {
        if (current.type !== "word_cloud") {
          throw invalid("maxEntries", "not_word_cloud", "Only a word cloud has a word limit");
        }
        if (maxEntries !== current.maxEntriesPerPerson && (await this.hasStarted(tx, current.id))) {
          throw new ApiException(
            409,
            "ACTIVITY_LOCKED",
            "This activity has started: only its wording can change until the session ends",
          );
        }
      }
      if (current.type === "poll" && options) {
        if (options.length < POLL_OPTIONS_MIN || options.length > POLL_OPTIONS_MAX) {
          throw invalid(
            "options",
            "count",
            `A poll has ${POLL_OPTIONS_MIN} to ${POLL_OPTIONS_MAX} options`,
          );
        }
        const known = new Map(current.options.map((option) => [option.id, option]));
        if (options.some((option) => option.id && !known.has(option.id))) {
          throw invalid("options", "unknown_option", "An option id is not in this poll");
        }
        const sameOptions =
          options.length === current.options.length &&
          options.every((option, i) => option.id === current.options[i].id);
        if (!sameOptions) {
          if (await this.hasStarted(tx, current.id)) {
            throw new ApiException(
              409,
              "ACTIVITY_LOCKED",
              "This activity has started: only its wording can change until the session ends",
            );
          }
          const kept = new Set(options.flatMap((option) => (option.id ? [option.id] : [])));
          const removed = current.options.filter((option) => !kept.has(option.id)).map((o) => o.id);
          // Answers from past sessions hang off their option: removing it would erase them.
          if (removed.length && (await tx.answer.count({ where: { optionId: { in: removed } } }))) {
            throw new ApiException(
              409,
              "ACTIVITY_LOCKED",
              "An option with answers from a past session cannot be removed",
            );
          }
          await tx.activityOption.deleteMany({ where: { id: { in: removed } } });
        }
        for (const [position, option] of options.entries()) {
          if (option.id) {
            await tx.activityOption.update({
              where: { id: option.id },
              data: { label: option.label, position },
              select: { id: true },
            });
          } else {
            await tx.activityOption.create({
              data: { activityId: current.id, label: option.label, position },
              select: { id: true },
            });
          }
        }
      }

      const updated = await tx.activity.update({
        where: { id: current.id },
        data: {
          prompt: body.prompt,
          ...(maxEntries !== undefined && { maxEntriesPerPerson: maxEntries }),
        },
        select: liveActivitySelect,
      });
      await tx.slide.update({
        where: { id: slide.id },
        data: { updatedAt: new Date() },
        select: { id: true },
      });
      await this.touchDeck(tx, deckId);
      const open = await tx.session.findMany({
        where: { deckId, status: { not: "ended" } },
        select: { id: true },
      });
      return { activity: toLiveActivity(updated), sessionIds: open.map((session) => session.id) };
    });

    for (const sessionId of sessionIds) {
      await this.events.publish(sessionId, "activity_edited", {
        activityId: activity.id,
        prompt: activity.prompt,
        options: activity.options,
        maxEntries: activity.maxEntries,
      });
    }
    return activity;
  }

  /** Started in a session that is still open: left draft there. */
  private async hasStarted(tx: Prisma.TransactionClient, activityId: string) {
    const runs = await tx.activityRun.count({
      where: { activityId, state: { not: "draft" }, session: { status: { not: "ended" } } },
    });
    return runs > 0;
  }

  /**
   * An activity slide stays in place while its deck has a live session (technical design §3.3),
   * whether or not the activity has started yet: the host may still reach it.
   */
  private async requireNoOpenSession(tx: Prisma.TransactionClient, deckId: string) {
    const open = await tx.session.count({ where: { deckId, status: { not: "ended" } } });
    if (open > 0) {
      throw new ApiException(
        409,
        "ACTIVITY_LOCKED",
        "End the live session before deleting an activity slide",
      );
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
