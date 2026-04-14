import { ui } from '@rezi-ui/core';
import type { TableColumn } from '@rezi-ui/core';
import type { EmailSummary } from '@mail-debugger/types';

export const emailColumns: TableColumn<EmailSummary>[] = [
  { key: 'id', header: 'ID', width: 5 },
  { key: 'from', header: 'From', width: 25, overflow: 'ellipsis' },
  { key: 'subject', header: 'Subject', flex: 1, overflow: 'ellipsis' },
  {
    key: 'date',
    header: 'Date',
    width: 20,
    render: (_value, row) => ui.text(new Date(row.receivedAt).toLocaleString()),
  },
  {
    key: 'att',
    header: 'Att',
    width: 4,
    render: (_value, row) => ui.text(row.hasAttachments ? 'Yes' : ''),
  },
];
