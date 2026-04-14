import {
  listEmails,
  getEmail,
  deleteEmail,
  deleteAllEmails,
  getHealth,
} from './api';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('listEmails', () => {
  it('should fetch emails without filters', async () => {
    const payload = { data: [], total: 0 };
    mockFetch.mockResolvedValue(jsonResponse(payload));

    const result = await listEmails();

    expect(mockFetch).toHaveBeenCalledWith('/api/emails', undefined);
    expect(result).toEqual(payload);
  });

  it('should append filter query params', async () => {
    const payload = { data: [], total: 0 };
    mockFetch.mockResolvedValue(jsonResponse(payload));

    await listEmails({ from: 'a@b.com', subject: 'hello' }, 10, 20);

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('from=a%40b.com');
    expect(url).toContain('subject=hello');
    expect(url).toContain('limit=10');
    expect(url).toContain('offset=20');
  });

  it('should throw on HTTP error with error body', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'not found' }, 404));

    await expect(listEmails()).rejects.toThrow('not found');
  });

  it('should throw with status code when no error body', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('parse fail')),
    });

    await expect(listEmails()).rejects.toThrow('HTTP 500');
  });
});

describe('getEmail', () => {
  it('should fetch a single email by id', async () => {
    const email = { id: 1, from: 'a@b.com', subject: 'Test' };
    mockFetch.mockResolvedValue(jsonResponse({ data: email }));

    const result = await getEmail(1);

    expect(mockFetch).toHaveBeenCalledWith('/api/emails/1', undefined);
    expect(result).toEqual(email);
  });
});

describe('deleteEmail', () => {
  it('should send DELETE request for a single email', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ deleted: true }));

    const result = await deleteEmail(5);

    expect(mockFetch).toHaveBeenCalledWith('/api/emails/5', {
      method: 'DELETE',
    });
    expect(result).toBe(true);
  });
});

describe('deleteAllEmails', () => {
  it('should send DELETE request to clear all emails', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ deleted: 42 }));

    const result = await deleteAllEmails();

    expect(mockFetch).toHaveBeenCalledWith('/api/emails', {
      method: 'DELETE',
    });
    expect(result).toBe(42);
  });
});

describe('getHealth', () => {
  it('should fetch health status', async () => {
    const health = {
      status: 'ok',
      smtpPort: 2525,
      apiPort: 3000,
      persistent: false,
      emailCount: 10,
    };
    mockFetch.mockResolvedValue(jsonResponse(health));

    const result = await getHealth();

    expect(mockFetch).toHaveBeenCalledWith('/api/health', undefined);
    expect(result).toEqual(health);
  });
});
