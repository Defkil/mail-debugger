import { parseConfig } from './config';

describe('parseConfig', () => {
  it('should default to TUI mode with no args', () => {
    const config = parseConfig([]);

    expect(config.mode).toBe('tui');
    expect(config.apiUrl).toBe('http://localhost:3000');
    expect(config.jsonOutput).toBe(false);
    expect(config.command).toBeUndefined();
  });

  it('should parse "list" command', () => {
    const config = parseConfig(['list']);

    expect(config.mode).toBe('command');
    expect(config.command?.name).toBe('list');
  });

  it('should parse "show" with id', () => {
    const config = parseConfig(['show', '42']);

    expect(config.command?.name).toBe('show');
    expect(config.command?.id).toBe(42);
  });

  it('should parse "delete" with id', () => {
    const config = parseConfig(['delete', '7']);

    expect(config.command?.name).toBe('delete');
    expect(config.command?.id).toBe(7);
  });

  it('should parse "delete-all" command', () => {
    const config = parseConfig(['delete-all']);

    expect(config.command?.name).toBe('delete-all');
  });

  it('should parse "health" command', () => {
    const config = parseConfig(['health']);

    expect(config.command?.name).toBe('health');
  });

  it('should parse --api-url flag', () => {
    const config = parseConfig(['--api-url', 'http://myhost:4000', 'list']);

    expect(config.apiUrl).toBe('http://myhost:4000');
    expect(config.command?.name).toBe('list');
  });

  it('should parse --json flag', () => {
    const config = parseConfig(['list', '--json']);

    expect(config.jsonOutput).toBe(true);
  });

  it('should parse filter flags for list', () => {
    const config = parseConfig([
      'list',
      '--from',
      'alice@test.com',
      '--to',
      'bob@test.com',
      '--subject',
      'hello',
      '--since',
      '2025-01-01',
      '--until',
      '2025-12-31',
    ]);

    expect(config.command?.filter).toEqual({
      from: 'alice@test.com',
      to: 'bob@test.com',
      subject: 'hello',
      since: '2025-01-01',
      until: '2025-12-31',
    });
  });

  it('should throw on invalid email id', () => {
    expect(() => parseConfig(['show', 'abc'])).toThrow('Invalid email ID');
  });

  it('should throw on missing --api-url value', () => {
    expect(() => parseConfig(['--api-url'])).toThrow(
      'Missing value for --api-url'
    );
  });

  it('should throw on missing --from value', () => {
    expect(() => parseConfig(['list', '--from'])).toThrow(
      'Missing value for --from'
    );
  });

  it('should throw on missing --to value', () => {
    expect(() => parseConfig(['list', '--to'])).toThrow(
      'Missing value for --to'
    );
  });

  it('should throw on missing --subject value', () => {
    expect(() => parseConfig(['list', '--subject'])).toThrow(
      'Missing value for --subject'
    );
  });

  it('should throw on missing --since value', () => {
    expect(() => parseConfig(['list', '--since'])).toThrow(
      'Missing value for --since'
    );
  });

  it('should throw on missing --until value', () => {
    expect(() => parseConfig(['list', '--until'])).toThrow(
      'Missing value for --until'
    );
  });

  it('should not include filter when no filter flags given', () => {
    const config = parseConfig(['list']);

    expect(config.command?.filter).toBeUndefined();
  });

  it('should parse show without id (no positional)', () => {
    const config = parseConfig(['show', '--json']);

    expect(config.command?.name).toBe('show');
    expect(config.command?.id).toBeUndefined();
  });
});
