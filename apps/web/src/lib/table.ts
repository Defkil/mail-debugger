import {
  createTableHook,
  tableFeatures,
  rowSortingFeature,
  rowPaginationFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createSortedRowModel,
  createPaginatedRowModel,
  sortFn_alphanumeric,
  sortFn_text,
} from '@tanstack/svelte-table';
import type { RowData } from '@tanstack/svelte-table';

/** Features, row models and sort functions shared by the app's tables. */
export const appTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  // The "auto" sort function of the string columns resolves to these.
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

export const { createAppTable, createAppColumnHelper } = createTableHook({
  features: appTableFeatures,
});

/** A table instance created by {@link createAppTable}. */
export type AppTable<TData extends RowData> = ReturnType<
  typeof createAppTable<TData>
>;
