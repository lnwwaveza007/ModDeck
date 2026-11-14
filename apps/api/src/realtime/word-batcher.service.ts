import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { VOTE_BATCH_MS } from "@moddeck/shared";
import { RoomEventsService } from "./room-events.service";
import { WordStoreService } from "./word-store.service";

/**
 * Sends the cloud of a word cloud to its room in batches, at most one per VOTE_BATCH_MS for each
 * run. Each update holds the whole cloud, so a lost or late one does no harm: the next corrects it.
 */
@Injectable()
export class WordBatcherService implements OnModuleDestroy {
  private readonly logger = new Logger(WordBatcherService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly store: WordStoreService,
    private readonly events: RoomEventsService,
  ) {}

  onModuleDestroy() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** A word was counted: it goes out with the next batch. */
  schedule(sessionId: string, runId: string) {
    if (this.timers.has(runId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(runId);
      this.publish(sessionId, runId).catch((err: unknown) => {
        this.logger.error(`Could not send the cloud of run ${runId}: ${String(err)}`);
      });
    }, VOTE_BATCH_MS);
    timer.unref();
    this.timers.set(runId, timer);
  }

  /** Sends the cloud now: the host just changed the state of the activity or hid a word. */
  async publishNow(sessionId: string, runId: string) {
    clearTimeout(this.timers.get(runId));
    this.timers.delete(runId);
    await this.publish(sessionId, runId);
  }

  private async publish(sessionId: string, runId: string) {
    const tally = await this.store.tally(sessionId, runId);
    await this.events.publish(sessionId, "word_update", { activityRunId: runId, ...tally });
  }
}
