import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { VOTE_BATCH_MS } from "@moddeck/shared";
import { PollStoreService } from "./poll-store.service";
import { RoomEventsService } from "./room-events.service";

/**
 * Sends the counts of a poll to its room in batches. Each update holds the whole count, so a lost
 * or late one does no harm: the next one corrects it.
 */
@Injectable()
export class VoteBatcherService implements OnModuleDestroy {
  private readonly logger = new Logger(VoteBatcherService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly store: PollStoreService,
    private readonly events: RoomEventsService,
  ) {}

  onModuleDestroy() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** A vote was counted: it goes out with the next batch. */
  schedule(sessionId: string, runId: string) {
    if (this.timers.has(runId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(runId);
      this.publish(sessionId, runId).catch((err: unknown) => {
        this.logger.error(`Could not send the counts of run ${runId}: ${String(err)}`);
      });
    }, VOTE_BATCH_MS);
    timer.unref();
    this.timers.set(runId, timer);
  }

  /** Sends the counts now: the host just changed the state of the poll. */
  async publishNow(sessionId: string, runId: string) {
    clearTimeout(this.timers.get(runId));
    this.timers.delete(runId);
    await this.publish(sessionId, runId);
  }

  private async publish(sessionId: string, runId: string) {
    const tally = await this.store.tally(sessionId, runId);
    await this.events.publish(sessionId, "vote_update", { activityRunId: runId, ...tally });
  }
}
