// Session history and results after class (F10). Not the Release 2 analytics: no heatmap, no
// learning-gap view. Everything here is read from PostgreSQL, after the final flush.

import type { SessionStatus } from "./events";
import type { LiveActivity, PollTally } from "./live";
import type { LiveQuestion } from "./participants";
import type { ReactionEmoji } from "./reactions";
import type { WordCloudTally } from "./words";

/** One row of GET /sessions, newest first. */
export interface SessionSummary {
  id: string;
  status: SessionStatus;
  startedAt: string;
  /** null while the session is still open. */
  endedAt: string | null;
  deck: {
    id: string;
    title: string;
    /** The deck was deleted: its sessions and their results stay (soft delete). */
    deleted: boolean;
  };
  /** People in the session at the end. A participant the host removed is not counted. */
  participantCount: number;
}

/**
 * One activity of the deck in this session, in slide order. `results` (poll) and `cloud` (word
 * cloud) are null when the host never started the activity. The wording is the deck's current
 * wording: an edit after class shows here too.
 */
export interface ActivityResult {
  slidePosition: number;
  activity: LiveActivity;
  /** false: the host never started it in this session. */
  ran: boolean;
  results: PollTally | null;
  /** Visible words only, like the projector. Hidden words are left out. */
  cloud: WordCloudTally | null;
}

/** The reactions sent while one slide was showing. Only slides that got at least one. */
export interface SlideReactions {
  slidePosition: number;
  counts: Partial<Record<ReactionEmoji, number>>;
}

/** GET /sessions/{sessionId}/results. Only for an ended session. */
export interface SessionResults {
  session: SessionSummary;
  activities: ActivityResult[];
  /** Q&A was open at some point in the session, so the Q&A card has something to show. */
  qaShown: boolean;
  /** Every question but deleted ones. Hidden ones are included, marked. Anonymous: no author. */
  questions: LiveQuestion[];
  /** In slide order. Only the history shows these: live screens never show a count. */
  reactions: SlideReactions[];
}
