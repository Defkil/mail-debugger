import type { MockInstance } from 'vitest';
import { healthCommand } from './health';
import { createMockClient, mockHealth } from './test-fixtures';

let consoleSpy: MockInstance;

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* noop */ });
});

afterEach(() => {
  consoleSpy.mockRestore();
});

describe('healthCommand', () => {
  it('should call health and print formatted output', async () => {
    const client = createMockClient();
    await healthCommand(client);

    expect(client.health).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('Status:      ok');
    expect(output).toContain('SMTP Port:   1025');
    expect(output).toContain('Email Count: 5');
  });

  it('should output JSON when json flag set', async () => {
    const client = createMockClient();
    await healthCommand(client, true);

    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toEqual(mockHealth);
  });
});
