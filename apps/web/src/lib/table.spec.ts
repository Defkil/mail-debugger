import type { PaginationState, SortingState } from '@tanstack/svelte-table';
import type { EmailSummary } from '@mail-debugger/types';
import { columns } from './columns';
import { createAppTable, type AppTable } from './table';

function summary(id: number, overrides: Partial<EmailSummary> = {}) {
  return {
    id,
    from: `user${id}@example.com`,
    to: ['to@example.com'],
    subject: `Subject ${id}`,
    receivedAt: `2026-01-0${id}T08:00:00.000Z`,
    hasAttachments: false,
    ...overrides,
  } satisfies EmailSummary;
}

/**
 * Builds the email table the way EmailTable.svelte does and inspects it.
 * Tests run Svelte's server build, where the adapter's effects are no-ops and
 * the table reads its initial options directly.
 */
function inspectTable<T>(
  data: EmailSummary[],
  state: { sorting?: SortingState; pagination?: PaginationState },
  rowCount: number,
  inspect: (table: AppTable<EmailSummary>) => T,
): T {
  const table = createAppTable({
    columns,
    data,
    manualPagination: true,
    rowCount,
    state,
  });
  return inspect(table);
}

const ids = (table: AppTable<EmailSummary>) =>
  table.getRowModel().rows.map((row) => row.original.id);

describe('email table', () => {
  const data = [
    summary(1, { subject: 'beta', from: 'carol@example.com' }),
    summary(3, { subject: 'Alpha', from: 'alice@example.com' }),
    summary(4, { subject: 'Delta', from: 'Dave@example.com' }),
    summary(2, { subject: 'gamma', from: 'bob@example.com' }),
  ];

  it('sorts text columns case-insensitively in both directions', () => {
    expect(
      inspectTable(data, { sorting: [{ id: 'subject', desc: false }] }, 4, ids),
    ).toEqual([3, 1, 4, 2]);
    expect(
      inspectTable(data, { sorting: [{ id: 'from', desc: true }] }, 4, ids),
    ).toEqual([4, 1, 2, 3]);
  });

  it('sorts ISO timestamps chronologically', () => {
    expect(
      inspectTable(
        data,
        { sorting: [{ id: 'receivedAt', desc: true }] },
        4,
        ids,
      ),
    ).toEqual([4, 3, 2, 1]);
  });

  it('keeps the server page as-is and derives the page count from the total', () => {
    const pagination = { pageIndex: 1, pageSize: 25 };
    const view = inspectTable(data, { pagination }, 60, (table) => ({
      ids: ids(table),
      pageCount: table.getPageCount(),
      canPrevious: table.getCanPreviousPage(),
      canNext: table.getCanNextPage(),
    }));

    expect(view).toEqual({
      ids: [1, 3, 4, 2],
      pageCount: 3,
      canPrevious: true,
      canNext: true,
    });
  });

  it('does not sort the recipient and attachment columns', () => {
    const sortable = inspectTable(data, {}, 4, (table) =>
      Object.fromEntries(
        table
          .getAllLeafColumns()
          .map((column) => [column.id, column.getCanSort()]),
      ),
    );

    expect(sortable).toEqual({
      from: true,
      to: false,
      subject: true,
      receivedAt: true,
      hasAttachments: false,
    });
  });
});
