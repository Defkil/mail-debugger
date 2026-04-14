import { createAppColumnHelper } from './table';
import type { EmailSummary } from '@mail-debugger/types';
import { timeAgo } from './format';

const col = createAppColumnHelper<EmailSummary>();

export const columns = col.columns([
  col.accessor('from', {
    header: 'From',
    cell: (info) => info.getValue(),
    size: 200,
  }),
  col.accessor('to', {
    header: 'To',
    cell: (info) => info.getValue().join(', '),
    size: 200,
    enableSorting: false,
  }),
  col.accessor('subject', {
    header: 'Subject',
    cell: (info) => info.getValue(),
    size: 300,
  }),
  col.accessor('receivedAt', {
    header: 'Received',
    cell: (info) => timeAgo(info.getValue()),
    size: 140,
  }),
  col.accessor('hasAttachments', {
    header: '📎',
    cell: (info) => (info.getValue() ? '📎' : ''),
    size: 50,
    enableSorting: false,
  }),
]);
