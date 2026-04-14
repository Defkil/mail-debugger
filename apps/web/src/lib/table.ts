import {
  createTableHook,
  tableFeatures,
  rowSortingFeature,
  rowPaginationFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createSortedRowModel,
  createPaginatedRowModel,
} from '@tanstack/svelte-table';

export const { createAppTable, createAppColumnHelper } = createTableHook({
  _features: tableFeatures({
    rowSortingFeature,
    rowPaginationFeature,
    columnSizingFeature,
    columnVisibilityFeature,
  }),
  _rowModels: {
    sortedRowModel: createSortedRowModel({}),
    paginatedRowModel: createPaginatedRowModel(),
  },
});
