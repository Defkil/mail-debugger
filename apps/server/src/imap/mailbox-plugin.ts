import type {
  Attribute,
  CommandHandler,
  IMAPConnection,
  IMAPServer,
  ParsedCommand,
  Plugin,
} from 'imapkit';
import { safeEqual } from '../crypto.js';
import type { Logger } from '../logger.js';
import { MAX_FLAG_LENGTH, type MailService } from '../mail/mail-service.js';
import type { MailCredentials } from '../types.js';
import { INBOX, MailboxAdapter } from './mailbox-adapter.js';
import { pacedFetch, type OutputLimits } from './output-control.js';

/** Most distinct keywords the INBOX keeps, including earlier ones. */
export const MAX_KEYWORDS = 256;

export interface ProfileOptions {
  service: MailService;
  logger: Logger;
  /** The one account that may log in. */
  credentials: MailCredentials;
  /** Whether clients may authenticate on a connection without TLS. */
  plaintextAuth: boolean;
  output: OutputLimits;
  /** Receives the adapter once ImapKit created the server. */
  onAdapter: (adapter: MailboxAdapter) => void;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * The restricted IMAP profile as an ImapKit plugin: one INBOX fed by SMTP,
 * readable, with flags and deletion, but no other mailboxes and no way to
 * add messages. Authentication accepts exactly the configured account and
 * requires TLS unless plaintext authentication is allowed. Flag changes and
 * expunges are stored through the {@link MailboxAdapter} before a command
 * reports success.
 */
export function mailboxProfile(options: ProfileOptions): Plugin {
  return (server: IMAPServer) => {
    const adapter = new MailboxAdapter(server, options.service, options.logger);
    options.onAdapter(adapter);
    registerAuthentication(server, options);
    registerInboxOnly(server);

    const wrap = (
      command: string,
      wrapper: (h: CommandHandler) => CommandHandler,
    ) => {
      const handler = server.getCommandHandler(command);
      if (!handler) throw new Error(`ImapKit has no ${command} command`);
      server.setCommandHandler(command, wrapper(handler));
    };
    wrap('FETCH', (handler) =>
      pacedFetch(handler, false, adapter, options.output, options.logger),
    );
    wrap('UID FETCH', (handler) =>
      pacedFetch(handler, true, adapter, options.output, options.logger),
    );
    wrap('STORE', (handler) => adapter.persistFlags(handler));
    wrap('UID STORE', (handler) => adapter.persistFlags(handler));
    wrap('EXPUNGE', (handler) => adapter.guardExpunge(handler));
    wrap('UID EXPUNGE', (handler) => adapter.guardExpunge(handler));
    wrap('CLOSE', (handler) => adapter.guardExpunge(handler));
    server.setCommandHandler('SUBSCRIBE', adapter.subscriptionCommand(true));
    server.setCommandHandler('UNSUBSCRIBE', adapter.subscriptionCommand(false));
    server.setCommandHandler('CHECK', adapter.checkCommand());
    server.commandChecks.push(checkKeywords);
  };
}

function registerAuthentication(
  server: IMAPServer,
  options: ProfileOptions,
): void {
  const log = options.logger;
  const allowed = (connection: IMAPConnection) =>
    connection.secureConnection || options.plaintextAuth;

  server.registerCapability(
    'AUTH=PLAIN',
    (connection) => unauthenticated(connection) && allowed(connection),
  );
  server.registerCapability(
    'SASL-IR',
    (connection) => unauthenticated(connection) && allowed(connection),
  );
  if (server.capabilities['STARTTLS']) {
    server.registerCapability(
      'STARTTLS',
      (connection) =>
        unauthenticated(connection) && !connection.secureConnection,
    );
  }
  server.registerCapability(
    'LOGINDISABLED',
    (connection) => unauthenticated(connection) && !allowed(connection),
  );

  // LOGIN and every AUTHENTICATE mechanism wait for TLS (RFC 9051 6.2.3).
  server.commandChecks.push((connection, parsed) => {
    const command = parsed.command.toUpperCase();
    const login = command === 'LOGIN' || command.startsWith('AUTHENTICATE ');
    return login && !allowed(connection)
      ? {
          command: 'NO',
          code: 'PRIVACYREQUIRED',
          text: 'Authentication requires TLS; run STARTTLS first',
        }
      : false;
  });

  const matches = (user: string, password: string) => {
    // Both comparisons always run, so timing reveals neither.
    const userMatches = safeEqual(user, options.credentials.user);
    const passwordMatches = safeEqual(password, options.credentials.password);
    return userMatches && passwordMatches;
  };
  const refuse = (
    connection: IMAPConnection,
    parsed: ParsedCommand,
    data: string,
    mechanism: string,
  ) => {
    log.warn({ mechanism }, 'Rejected IMAP authentication');
    connection.sendStatus(
      parsed,
      data,
      'NO',
      'Login failed: authentication failure',
      'AUTHENTICATIONFAILED',
    );
  };

  server.setCommandHandler('LOGIN', (connection, parsed, data, callback) => {
    const attributes: Attribute[] = parsed.attributes ?? [];
    if (
      attributes.length !== 2 ||
      attributes.some((attribute) => !isAstring(attribute))
    ) {
      connection.sendStatus(
        parsed,
        data,
        'BAD',
        'LOGIN takes 2 string arguments',
      );
      return callback();
    }
    const [user, password] = attributes.map((attribute) =>
      String(attribute.value),
    );
    // LOGIN takes no UTF-8; such names need AUTHENTICATE (RFC 9755 5).
    if (/[\u{80}-\u{FF}]/u.test(user + password)) {
      connection.sendStatus(
        parsed,
        data,
        'BAD',
        'LOGIN does not take UTF-8 user names or passwords, use AUTHENTICATE',
      );
      return callback();
    }
    if (matches(user, password)) {
      logIn(connection, parsed, data, user);
    } else {
      refuse(connection, parsed, data, 'LOGIN');
    }
    callback();
  });

  const authenticatePlain = (
    connection: IMAPConnection,
    parsed: ParsedCommand,
    data: string,
    input: string,
  ) => {
    const bad = (text: string) =>
      connection.sendStatus(parsed, data, 'BAD', text);
    const decoded = connection.decodeSaslResponse(input);
    if (!decoded) return bad('Invalid base64 in SASL response');
    let message: string;
    try {
      message = utf8.decode(decoded);
    } catch {
      return bad('Invalid UTF-8 in SASL PLAIN message');
    }
    // RFC 4616: authzid NUL authcid NUL passwd
    const parts = message.split('\0');
    if (parts.length !== 3) return bad('Malformed SASL PLAIN message');
    const [authzid, user, password] = parts;
    if (!matches(user, password)) {
      return refuse(connection, parsed, data, 'PLAIN');
    }
    if (authzid && authzid !== user) {
      // Valid credentials, but acting as someone else is not supported.
      return connection.sendStatus(
        parsed,
        data,
        'NO',
        'Acting as another user is not supported',
        'AUTHORIZATIONFAILED',
      );
    }
    logIn(connection, parsed, data, user);
  };

  server.setCommandHandler(
    'AUTHENTICATE PLAIN',
    (connection, parsed, data, callback) => {
      const attributes: Attribute[] | undefined = parsed.attributes;
      if (!attributes) {
        // Without an initial response the client sends it after "+ ".
        connection.inputHandler = (line: string) => {
          connection.inputHandler = false;
          if (line === '*') {
            connection.sendStatus(
              parsed,
              data,
              'BAD',
              'Authentication cancelled',
            );
            return;
          }
          authenticatePlain(connection, parsed, data, line);
        };
        connection.sendContinuation('', 'AUTHENTICATE PLAIN');
      } else if (attributes.length === 1 && attributes[0]?.type === 'ATOM') {
        authenticatePlain(
          connection,
          parsed,
          data,
          String(attributes[0].value),
        );
      } else {
        connection.sendStatus(
          parsed,
          data,
          'BAD',
          'Invalid arguments for AUTHENTICATE PLAIN',
        );
      }
      callback();
    },
  );
}

/**
 * Commands that would create mailboxes or add messages: they are
 * recognised and refused with a truthful response code, never faked.
 */
function registerInboxOnly(server: IMAPServer): void {
  server.setCommandHandler('CREATE', (connection, parsed, data, callback) => {
    const [name] = mailboxArguments(parsed, 1) ?? [];
    if (name === undefined) {
      status(
        connection,
        parsed,
        data,
        'BAD',
        'CREATE expects 1 mailbox argument',
      );
    } else if (isInbox(name)) {
      status(
        connection,
        parsed,
        data,
        'NO',
        'INBOX already exists',
        'ALREADYEXISTS',
      );
    } else {
      status(
        connection,
        parsed,
        data,
        'NO',
        'This server has only INBOX and does not create mailboxes',
        'CANNOT',
      );
    }
    callback();
  });

  server.setCommandHandler('DELETE', (connection, parsed, data, callback) => {
    const [name] = mailboxArguments(parsed, 1) ?? [];
    if (name === undefined) {
      status(
        connection,
        parsed,
        data,
        'BAD',
        'DELETE expects 1 mailbox argument',
      );
    } else if (isInbox(name)) {
      status(
        connection,
        parsed,
        data,
        'NO',
        'INBOX cannot be deleted',
        'CANNOT',
      );
    } else {
      status(
        connection,
        parsed,
        data,
        'NO',
        'Mailbox does not exist',
        'NONEXISTENT',
      );
    }
    callback();
  });

  server.setCommandHandler('RENAME', (connection, parsed, data, callback) => {
    const [name] = mailboxArguments(parsed, 2) ?? [];
    if (name === undefined) {
      status(
        connection,
        parsed,
        data,
        'BAD',
        'RENAME expects 2 mailbox arguments',
      );
    } else if (isInbox(name)) {
      status(
        connection,
        parsed,
        data,
        'NO',
        'INBOX cannot be renamed',
        'CANNOT',
      );
    } else {
      status(
        connection,
        parsed,
        data,
        'NO',
        'Mailbox does not exist',
        'NONEXISTENT',
      );
    }
    callback();
  });

  server.setCommandHandler('APPEND', (connection, parsed, data, callback) => {
    const attributes: Attribute[] = parsed.attributes ?? [];
    const [target] = attributes;
    if (
      attributes.length < 2 ||
      !isAstring(target) ||
      attributes.at(-1)?.type !== 'LITERAL'
    ) {
      status(
        connection,
        parsed,
        data,
        'BAD',
        'APPEND expects a mailbox and a message literal',
      );
    } else {
      refuseTarget(connection, parsed, data, String(target.value));
    }
    callback();
  });

  server.setCommandHandler('COPY', copyCommand);
  server.setCommandHandler('UID COPY', copyCommand);

  // A synchronising APPEND literal is refused before the client sends it.
  // ImapKit's own filter answers missing mailboxes with TRYCREATE first.
  server.literalFilters.push((connection, command) =>
    command === 'APPEND' && !connection.isBusy()
      ? {
          command: 'NO',
          code: 'NOPERM',
          text: 'Messages arrive over SMTP only; IMAP cannot add them',
        }
      : false,
  );
}

/** Refuses STORE commands that would exceed the keyword limits. */
function checkKeywords(connection: IMAPConnection, parsed: ParsedCommand) {
  const command = parsed.command.toUpperCase();
  if (command !== 'STORE' && command !== 'UID STORE') return false;
  const [, item, value] = parsed.attributes ?? [];
  if (
    item?.type !== 'ATOM' ||
    !/^\+?FLAGS(\.SILENT)?$/i.test(String(item.value))
  ) {
    return false;
  }
  const flags: Attribute[] = Array.isArray(value) ? value : [value];
  const keywords = flags
    .map((flag) =>
      String(typeof flag === 'string' ? flag : (flag?.value ?? '')),
    )
    .filter((flag) => flag && !flag.startsWith('\\'));
  if (keywords.some((keyword) => keyword.length > MAX_FLAG_LENGTH)) {
    return {
      command: 'NO',
      code: 'LIMIT',
      text: `Keywords can have at most ${MAX_FLAG_LENGTH} characters`,
    };
  }
  const mailbox = connection.selectedMailbox;
  if (!mailbox) return false;
  const known = new Set(
    (mailbox.knownFlags ?? []).filter((flag) => !flag.startsWith('\\')),
  );
  const added = new Set(keywords.filter((keyword) => !known.has(keyword)));
  return known.size + added.size > MAX_KEYWORDS
    ? {
        command: 'NO',
        code: 'LIMIT',
        text: `The mailbox can have at most ${MAX_KEYWORDS} keywords`,
      }
    : false;
}

function isAstring(attribute: Attribute): boolean {
  return !!attribute && ['STRING', 'LITERAL', 'ATOM'].includes(attribute.type);
}

function unauthenticated(connection: IMAPConnection): boolean {
  return connection.state === 'Not Authenticated';
}

function logIn(
  connection: IMAPConnection,
  parsed: ParsedCommand,
  data: string,
  user: string,
): void {
  connection.state = 'Authenticated';
  connection.username = user;
  connection.sendStatus(parsed, data, 'OK', 'User logged in');
}

function isInbox(name: string): boolean {
  return name.toUpperCase() === INBOX;
}

/** COPY and UID COPY can only target INBOX, which takes no copies. */
const copyCommand: CommandHandler = (connection, parsed, data, callback) => {
  const attributes: Attribute[] = parsed.attributes ?? [];
  const [set, target] = attributes;
  if (
    attributes.length !== 2 ||
    !['ATOM', 'SEQUENCE'].includes(set?.type) ||
    !isAstring(target)
  ) {
    status(
      connection,
      parsed,
      data,
      'BAD',
      `${parsed.command.toUpperCase()} expects a sequence set and a mailbox`,
    );
  } else {
    refuseTarget(connection, parsed, data, String(target.value));
  }
  callback();
};

/** APPEND and COPY: new mail only arrives over SMTP. */
function refuseTarget(
  connection: IMAPConnection,
  parsed: ParsedCommand,
  data: string,
  target: string,
): void {
  if (isInbox(target)) {
    status(
      connection,
      parsed,
      data,
      'NO',
      'Messages arrive over SMTP only; IMAP cannot add them',
      'NOPERM',
    );
  } else {
    status(
      connection,
      parsed,
      data,
      'NO',
      'Mailbox does not exist',
      'TRYCREATE',
    );
  }
}

function status(
  connection: IMAPConnection,
  parsed: ParsedCommand,
  data: string,
  command: 'NO' | 'BAD',
  text: string,
  code?: string,
): void {
  connection.sendStatus(parsed, data, command, text, code);
}

/** The mailbox names of a command with exactly `count` astring arguments. */
function mailboxArguments(
  parsed: ParsedCommand,
  count: number,
): string[] | undefined {
  const attributes: Attribute[] = parsed.attributes ?? [];
  return attributes.length === count &&
    attributes.every((attribute) => isAstring(attribute))
    ? attributes.map((attribute) => String(attribute.value))
    : undefined;
}
