import { handleDeleteKey } from './delete-handler';
import type { DeleteHandlerDeps } from './delete-handler';
import { createInitialState } from './state';
import type { TuiState } from './state';
import type { EmailSummary, Email } from '@mail-debugger/types';

const mockSummary: EmailSummary = {
  id: 1,
  from: 'sender@example.com',
  to: ['recipient@example.com'],
  subject: 'Test',
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
  subject: 'Test',
  textBody: 'body',
  htmlBody: null,
  raw: 'raw',
  headers: {},
  attachments: [],
  receivedAt: '2025-01-01T00:00:00Z',
};

function createDeps(
  state: TuiState,
  routeId: string,
  overrides?: Partial<DeleteHandlerDeps>,
): DeleteHandlerDeps {
  return {
    getCurrentState: () => state,
    getCurrentRouteId: () => routeId,
    isInputFocused: () => false,
    getFocusedEmail: () => state.emails[state.focusedEmailIndex],
    client: {
      listEmails: vi.fn(),
      getEmail: vi.fn(),
      deleteEmail: vi.fn().mockResolvedValue(true),
      deleteAllEmails: vi.fn().mockResolvedValue(1),
      health: vi.fn(),
    },
    navigateBack: vi.fn(),
    // eslint-disable-next-line unicorn/no-useless-undefined
    refreshEmails: vi.fn().mockResolvedValue(undefined),
    setError: vi.fn(),
    ...overrides,
  };
}

describe('handleDeleteKey', () => {
  it('should do nothing when input is focused', () => {
    const state = createInitialState();
    const deps = createDeps(state, 'list', {
      isInputFocused: () => true,
    });

    handleDeleteKey(deps, false);

    expect(deps.client.deleteEmail).not.toHaveBeenCalled();
    expect(deps.client.deleteAllEmails).not.toHaveBeenCalled();
  });

  describe('on detail screen', () => {
    it('should delete selected email', () => {
      const state = { ...createInitialState(), selectedEmail: mockEmail };
      const deps = createDeps(state, 'detail');

      handleDeleteKey(deps, false);

      expect(deps.client.deleteEmail).toHaveBeenCalledWith(1);
    });

    it('should do nothing when no email is selected', () => {
      const state = createInitialState();
      const deps = createDeps(state, 'detail');

      handleDeleteKey(deps, false);

      expect(deps.client.deleteEmail).not.toHaveBeenCalled();
    });
  });

  describe('on list screen', () => {
    it('should delete focused email on lowercase d', () => {
      const state = {
        ...createInitialState(),
        emails: [mockSummary],
        focusedEmailIndex: 0,
      };
      const deps = createDeps(state, 'list');

      handleDeleteKey(deps, false);

      expect(deps.client.deleteEmail).toHaveBeenCalledWith(1);
    });

    it('should delete all emails on shift+d', () => {
      const state = {
        ...createInitialState(),
        emails: [mockSummary],
      };
      const deps = createDeps(state, 'list');

      handleDeleteKey(deps, true);

      expect(deps.client.deleteAllEmails).toHaveBeenCalled();
    });

    it('should not delete all when list is empty', () => {
      const state = createInitialState();
      const deps = createDeps(state, 'list');

      handleDeleteKey(deps, true);

      expect(deps.client.deleteAllEmails).not.toHaveBeenCalled();
    });

    it('should not delete single when no focused email', () => {
      const state = createInitialState();
      const deps = createDeps(state, 'list');

      handleDeleteKey(deps, false);

      expect(deps.client.deleteEmail).not.toHaveBeenCalled();
    });
  });

  it('should do nothing on unknown route', () => {
    const state = createInitialState();
    const deps = createDeps(state, 'unknown');

    handleDeleteKey(deps, false);

    expect(deps.client.deleteEmail).not.toHaveBeenCalled();
    expect(deps.client.deleteAllEmails).not.toHaveBeenCalled();
  });
});
