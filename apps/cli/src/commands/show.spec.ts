import { showCommand } from './show';
import { createMockClient } from './test-fixtures';

let consoleSpy: jest.SpyInstance;

beforeEach(() => {
  consoleSpy = jest.spyOn(console, 'log').mockImplementation();
});

afterEach(() => {
  consoleSpy.mockRestore();
});

describe('showCommand', () => {
  it('should call getEmail and print detail', async () => {
    const client = createMockClient();
    await showCommand(client, 1);

    expect(client.getEmail).toHaveBeenCalledWith(1);
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('sender@example.com');
    expect(output).toContain('Hello World');
  });

  it('should output JSON when json flag set', async () => {
    const client = createMockClient();
    await showCommand(client, 1, true);

    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.id).toBe(1);
    expect(parsed.subject).toBe('Test Subject');
  });

  it('should propagate error when email not found', async () => {
    const client = createMockClient({
      getEmail: jest.fn().mockRejectedValue(new Error('Email not found')),
    });

    await expect(showCommand(client, 999)).rejects.toThrow('Email not found');
  });
});
