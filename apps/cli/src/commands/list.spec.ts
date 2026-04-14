import type { MockInstance } from 'vitest';
import { listCommand } from './list';
import { createMockClient, mockSummary } from './test-fixtures';

let consoleSpy: MockInstance;

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* noop */ });
});

afterEach(() => {
  consoleSpy.mockRestore();
});

describe('listCommand', () => {
  it('should call listEmails and print table', async () => {
    const client = createMockClient();
    await listCommand(client);

    expect(client.listEmails).toHaveBeenCalledWith(undefined);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('sender@example.com');
    expect(output).toContain('Test Subject');
  });

  it('should pass filter to listEmails', async () => {
    const client = createMockClient();
    const filter = { from: 'alice@test.com' };
    await listCommand(client, filter);

    expect(client.listEmails).toHaveBeenCalledWith(filter);
  });

  it('should output JSON when json flag set', async () => {
    const client = createMockClient();
    await listCommand(client, undefined, true);

    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toEqual([mockSummary]);
  });

  it('should show "No emails found." for empty list', async () => {
    const client = createMockClient({
      listEmails: vi.fn().mockResolvedValue([]),
    });
    await listCommand(client);

    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toBe('No emails found.');
  });
});
