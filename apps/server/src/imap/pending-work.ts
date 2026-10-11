import type { IMAPConnection, Message, Notification } from 'imapkit';

/** Commands waiting behind an asynchronous FETCH or CHECK. */
export const MAX_QUEUED_COMMANDS = 64;
export const MAX_QUEUED_COMMAND_BYTES = 4 * 1024 * 1024;
/** Mailbox updates waiting for a selected client to issue its next command. */
export const MAX_QUEUED_NOTIFICATIONS = 1024;

/**
 * ImapKit bounds individual input lines and literals, but its command and
 * notification queues have no limit. Bound both, including sources of
 * expunged messages retained for a session's old sequence numbers. The
 * queued-command fields are part of the pinned ImapKit 5.0.1 declarations.
 */
export function limitPendingWork(
  connection: IMAPConnection,
  retainedBytes: number,
  onExceeded: (reason: 'commands' | 'notifications') => void,
): void {
  const refuse = (reason: 'commands' | 'notifications') => {
    onExceeded(reason);
    connection.bye('Too much pending work; reconnect and select INBOX again');
    // Do not let a peer that never sends FIN keep a refused session open.
    connection.socket?.destroySoon();
  };
  const scheduleCommand = connection.scheduleCommand.bind(connection);
  connection.scheduleCommand = (data, scripted) => {
    if (!connection.isOpen()) return;
    const queue = connection._commandQueue;
    if (
      queue.length >= MAX_QUEUED_COMMANDS ||
      queue.reduce((bytes, command) => bytes + command.data.length, 0) +
        data.length >
        MAX_QUEUED_COMMAND_BYTES
    ) {
      refuse('commands');
      return;
    }
    scheduleCommand(data, scripted);
  };

  const queueNotification = connection.queueNotification.bind(connection);
  connection.queueNotification = (command, notification) => {
    if (!connection.isOpen()) return;
    const queue = connection.notificationQueue;
    if (
      queue.length >= MAX_QUEUED_NOTIFICATIONS ||
      retainedSources([...queue, command]) > retainedBytes
    ) {
      refuse('notifications');
      return;
    }
    queueNotification(command, notification);
  };
}

/** Count each deleted source once, even when several updates refer to it. */
function retainedSources(queue: readonly Notification[]): number {
  const messages = new Set<Message>();
  for (const notification of queue) {
    if (notification.message?.ghost) messages.add(notification.message);
    const snapshot = notification.mailboxCopy ?? [];
    for (const message of snapshot) {
      if (message.ghost) messages.add(message);
    }
    const flags = notification.flagUpdate ?? [];
    for (const message of flags) {
      if (message.ghost) messages.add(message);
    }
  }
  // Account conservatively for a JS string's two-byte representation.
  return [...messages].reduce(
    (bytes, message) => bytes + 2 * message.raw.length,
    0,
  );
}
