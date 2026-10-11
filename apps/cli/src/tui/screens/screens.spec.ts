import type { RouteRenderContext } from '@rezi-ui/core';
import { createTestRenderer } from '@rezi-ui/core/testing';
import type { ApiClient, Email, EmailSummary } from '@mail-debugger/client';
import { createInitialState, type TuiState } from '../state.js';
import { createDetailScreen } from './detail-screen.js';
import { createListScreen } from './list-screen.js';

// The screens are rendered with Rezi's test renderer: the whole layout and
// draw pipeline runs, without a terminal and without the native engine.

const APP_TITLE = 'Mail Debugger | http://127.0.0.1:3000';
// The screens call the client only when a key or button is pressed.
const client = {} as ApiClient;

const summary: EmailSummary = {
  id: 7,
  from: 'alice@example.test',
  to: ['bob@example.test'],
  subject: 'Welcome aboard',
  receivedAt: '2026-10-11T10:00:00.000Z',
  hasAttachments: true,
};

const email: Email = {
  ...summary,
  messageId: '<welcome@example.test>',
  cc: ['carol@example.test'],
  bcc: [],
  textBody: 'Hello Bob,\nyour account is ready.',
  htmlBody: null,
  raw: '',
  headers: {},
  attachments: [
    {
      filename: 'terms.pdf',
      size: 1234,
      contentType: 'application/pdf',
      content: '',
    },
  ],
};

function render(
  screen: ReturnType<typeof createListScreen>,
  state: Partial<TuiState>,
): string {
  const context: RouteRenderContext<TuiState> = {
    router: {} as RouteRenderContext<TuiState>['router'],
    state: { ...createInitialState(), isLoading: false, ...state },
    update: vi.fn(),
    outlet: null,
  };
  return createTestRenderer({ viewport: { cols: 120, rows: 30 } })
    .render(screen.screen({}, context))
    .toText();
}

const noop = vi.fn();
const listScreen = () =>
  createListScreen({
    appTitle: APP_TITLE,
    client,
    setCurrentState: noop,
    loadEmailDetail: () => Promise.resolve(),
    navigateToDetail: noop,
    refreshEmails: () => Promise.resolve(),
    getFocusedEmail: vi.fn(),
    quit: noop,
  });
const detailScreen = () =>
  createDetailScreen({
    appTitle: APP_TITLE,
    client,
    setCurrentState: noop,
    navigateBack: noop,
    refreshEmails: () => Promise.resolve(),
    quit: noop,
  });

describe('inbox screens', () => {
  it('lists the emails with id, sender, subject and attachment mark', () => {
    const text = render(listScreen(), { emails: [summary] });
    expect(text).toContain(APP_TITLE);
    expect(text).toContain('1 email(s)');
    expect(text).toMatch(/7\s+alice@example\.test\s+Welcome aboard/);
    expect(text).toMatch(/Yes/);
    expect(text).toContain('[D] Delete All');
  });

  it('shows an error and the filter bar', () => {
    const text = render(listScreen(), {
      error: 'Server not reachable',
      filterVisible: true,
    });
    expect(text).toContain('0 email(s)');
    expect(text).toContain('Server not reachable');
    expect(text).toContain('Filter');
    expect(text).toContain('Subject:');
  });

  it('shows the headers, attachments and text body of an email', () => {
    const text = render(detailScreen(), { selectedEmail: email });
    expect(text).toContain(`${APP_TITLE} > Email #7`);
    expect(text).toMatch(/To:\s+bob@example\.test/);
    expect(text).toMatch(/CC:\s+carol@example\.test/);
    expect(text).not.toContain('BCC:');
    expect(text).toMatch(/Message-ID:\s+<welcome@example\.test>/);
    expect(text).toMatch(/terms\.pdf\s+application\/pdf\s+1234 bytes/);
    expect(text).toContain('Hello Bob,');
    expect(text).toContain('your account is ready.');
  });

  it('waits for the email it is about to show', () => {
    const text = render(detailScreen(), { selectedEmail: null });
    expect(text).toContain(`${APP_TITLE} > Loading...`);
    expect(text).toContain('Loading email...');
  });
});
