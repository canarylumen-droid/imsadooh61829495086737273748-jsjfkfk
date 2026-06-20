const BUSY_MAILBOX_TTL_MS = 30 * 60 * 1000;
const REPLY_BURST_THRESHOLD = 5;

interface MailboxState {
  replyCount: number;
  lastReplyAt: number;
  busyUntil: number;
  pendingReplies: number;
}

const mailboxStates = new Map<string, MailboxState>();

export function recordIncomingReply(integrationId: string): void {
  const now = Date.now();
  const state = mailboxStates.get(integrationId) || {
    replyCount: 0, lastReplyAt: 0, busyUntil: 0, pendingReplies: 0,
  };

  state.replyCount++;
  state.lastReplyAt = now;
  state.pendingReplies++;
  state.busyUntil = now + BUSY_MAILBOX_TTL_MS;

  mailboxStates.set(integrationId, state);

  if (state.replyCount >= REPLY_BURST_THRESHOLD) {
    console.log(`[MailboxCoord] ${integrationId.slice(-8)} hit ${state.replyCount} replies — marked busy for ${BUSY_MAILBOX_TTL_MS / 60000}m`);
  }
}

export function resolvePendingReply(integrationId: string): void {
  const state = mailboxStates.get(integrationId);
  if (state && state.pendingReplies > 0) {
    state.pendingReplies--;
    mailboxStates.set(integrationId, state);
  }
}

export function isMailboxBusy(integrationId: string): boolean {
  const state = mailboxStates.get(integrationId);
  if (!state) return false;
  if (Date.now() > state.busyUntil) {
    mailboxStates.delete(integrationId);
    return false;
  }
  return state.pendingReplies > 0;
}

export function shouldYieldInitialSends(integrationId: string): { yield: boolean; reason?: string } {
  const state = mailboxStates.get(integrationId);
  if (!state) return { yield: false };
  if (Date.now() > state.busyUntil) {
    mailboxStates.delete(integrationId);
    return { yield: false };
  }
  if (state.pendingReplies > 0) {
    return { yield: true, reason: `${state.pendingReplies} pending auto-replies to send first` };
  }
  if (state.replyCount >= REPLY_BURST_THRESHOLD) {
    const remainingMin = Math.ceil((state.busyUntil - Date.now()) / 60000);
    return { yield: true, reason: `burst of ${state.replyCount} replies — cooling for ${remainingMin}m` };
  }
  return { yield: false };
}

export function getMailboxCoordMetrics(): Record<string, any> {
  const now = Date.now();
  const metrics: Record<string, any> = {};
  for (const [id, state] of mailboxStates) {
    metrics[id.slice(-8)] = {
      replyCount: state.replyCount,
      pendingReplies: state.pendingReplies,
      busy: now < state.busyUntil,
      busyUntil: new Date(state.busyUntil).toISOString(),
    };
  }
  return metrics;
}