import net from 'node:net';
import tls from 'node:tls';

/**
 * A raw IMAP connection for protocol transcripts. Output is decoded as
 * latin1, so literal lengths count octets.
 */
export class ImapTranscript {
  private output = '';
  private readonly listeners = new Set<() => void>();
  private ended = false;

  private constructor(readonly socket: net.Socket) {
    socket.setEncoding('latin1');
    socket.on('data', (chunk: string) => {
      this.output += chunk;
      this.notify();
    });
    socket.on('close', () => {
      this.ended = true;
      this.notify();
    });
    socket.on('error', () => {
      // Reported through `closed`.
    });
  }

  static connect(
    port: number,
    options: { tls?: boolean } = {},
  ): Promise<ImapTranscript> {
    return new Promise((resolve, reject) => {
      const socket = options.tls
        ? tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false })
        : net.connect({ host: '127.0.0.1', port });
      socket.once(options.tls ? 'secureConnect' : 'connect', () =>
        resolve(new ImapTranscript(socket)),
      );
      socket.once('error', reject);
    });
  }

  /** Whether the server closed the connection. */
  get closed(): boolean {
    return this.ended;
  }

  /** Everything received so far that no read consumed. */
  get pending(): string {
    return this.output;
  }

  write(data: string): void {
    this.socket.write(data, 'latin1');
  }

  /** Waits for the greeting line. */
  greeting(): Promise<string> {
    return this.readUntil((text) => /\r\n/.test(text));
  }

  /** Sends a tagged command and returns the output up to its tagged response. */
  command(tag: string, line: string, timeoutMs?: number): Promise<string> {
    this.write(`${tag} ${line}\r\n`);
    return this.tagged(tag, timeoutMs);
  }

  /** Reads up to and including the tagged response with `tag`. */
  tagged(tag: string, timeoutMs?: number): Promise<string> {
    const pattern = new RegExp(
      String.raw`(^|\r\n)${escape(tag)} (OK|NO|BAD)[^\r]*\r\n`,
    );
    return this.readUntil((text) => pattern.test(text), timeoutMs);
  }

  /** Consumes output until `done` returns true for it. */
  readUntil(
    done: (text: string) => boolean,
    timeoutMs = 5000,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (done(this.output)) {
          cleanup();
          const text = this.output;
          this.output = '';
          resolve(text);
        } else if (this.ended) {
          cleanup();
          reject(new Error(`Connection closed; received:\n${this.output}`));
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out; received:\n${this.output}`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(check);
      };
      this.listeners.add(check);
      check();
    });
  }

  /** Resolves when the server closes the connection. */
  async waitForClose(timeoutMs = 5000): Promise<void> {
    await this.readUntil(() => this.ended, timeoutMs);
  }

  close(): void {
    this.socket.destroy();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

function escape(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
