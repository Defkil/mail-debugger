import type { MockInstance } from 'vitest';
import { deleteAllCommand } from './delete-all';
import { createMockClient } from './test-fixtures';

let consoleSpy: MockInstance;

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* noop */ });
});

afterEach(() => {
  consoleSpy.mockRestore();
});

describe('deleteAllCommand', () => {
  it('should call deleteAllEmails and print count', async () => {
    const client = createMockClient();
    await deleteAllCommand(client);

    expect(client.deleteAllEmails).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toBe('Deleted 3 email(s).');
  });

  it('should output JSON when json flag set', async () => {
    const client = createMockClient();
    await deleteAllCommand(client, true);

    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({ deleted: 3 });
  });
});
