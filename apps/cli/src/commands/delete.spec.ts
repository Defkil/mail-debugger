import { deleteCommand } from './delete';
import { createMockClient } from './test-fixtures';

let consoleSpy: jest.SpyInstance;

beforeEach(() => {
  consoleSpy = jest.spyOn(console, 'log').mockImplementation();
});

afterEach(() => {
  consoleSpy.mockRestore();
});

describe('deleteCommand', () => {
  it('should call deleteEmail and print success', async () => {
    const client = createMockClient();
    await deleteCommand(client, 1);

    expect(client.deleteEmail).toHaveBeenCalledWith(1);
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toBe('Email 1 deleted.');
  });

  it('should print "not found" when delete returns false', async () => {
    const client = createMockClient({
      deleteEmail: jest.fn().mockResolvedValue(false),
    });
    await deleteCommand(client, 999);

    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toBe('Email 999 not found.');
  });

  it('should output JSON when json flag set', async () => {
    const client = createMockClient();
    await deleteCommand(client, 1, true);

    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({ id: 1, deleted: true });
  });
});
