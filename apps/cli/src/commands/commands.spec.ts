import { listCommand } from './list';
import { showCommand } from './show';
import { deleteCommand } from './delete';
import { deleteAllCommand } from './delete-all';
import { healthCommand } from './health';
import type { ApiClient } from '../api/client';
import type { Email, EmailSummary, HealthResponse } from '../types';

const mockSummary: EmailSummary = {
  id: 1,
  from: 'sender@example.com',
  to: ['recipient@example.com'],
  subject: 'Test Subject',
  receivedAt: '2025-01-01T00:00:00Z',
  hasAttachments: false,
};

const mockEmail: Email = {
  id: 1,
  messageId: '<test@example.com>',
  from: 'sender@example.com',
  to: ['recipient@example.com'],
  cc: [],
  bcc: [],
  subject: 'Test Subject',
  textBody: 'Hello World',
  htmlBody: null,
  raw: 'raw',
  headers: {},
  attachments: [],
  receivedAt: '2025-01-01T00:00:00Z',
};

const mockHealth: HealthResponse = {
  status: 'ok',
  smtpPort: 1025,
  apiPort: 3000,
  persistent: false,
  emailCount: 5,
};

function createMockClient(overrides?: Partial<ApiClient>): ApiClient {
  return {
    listEmails: jest.fn().mockResolvedValue([mockSummary]),
    getEmail: jest.fn().mockResolvedValue(mockEmail),
    deleteEmail: jest.fn().mockResolvedValue(true),
    deleteAllEmails: jest.fn().mockResolvedValue(3),
    health: jest.fn().mockResolvedValue(mockHealth),
    ...overrides,
  };
}

let consoleSpy: jest.SpyInstance;

beforeEach(() => {
  consoleSpy = jest.spyOn(console, 'log').mockImplementation();
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
      listEmails: jest.fn().mockResolvedValue([]),
    });
    await listCommand(client);

    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toBe('No emails found.');
  });
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
