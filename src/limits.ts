// Every timing the mod runs on, in one place.

/** How often each session writes its file and reads everyone's. */
export const BEAT_MS = 2_000
/** How often each session re-reads its repo's worktrees. */
export const GIT_MS = 8_000
/** A session writes its file at most this often between heartbeats. */
export const MIN_WRITE_MS = 1_000
/** At most one notification per machine this often. */
export const NOTIFY_EVERY_MS = 30_000
/** A session whose file has not changed for this long is offline. */
export const OFFLINE_AFTER_MS = 30_000
/** A closed session stays listed this long. */
export const HIDE_ENDED_AFTER_MS = 30_000
/** A working agent with no new activity for this long is stuck. */
export const STUCK_AFTER_MS = 10 * 60_000
/** A silent session disappears after this long. */
export const FORGET_AFTER_MS = 10 * 60_000
/** The feed keeps this much history. */
export const EVENTS_KEEP_MS = 60 * 60_000
/** The activity bars cover this much time. */
export const TRAIL_MS = 28 * 60_000
/** Files of sessions gone this long are deleted. */
export const PRUNE_AFTER_MS = 24 * 60 * 60_000
/** A finished subagent stays listed this long. */
export const DONE_SHOWN_MS = 5 * 60_000
