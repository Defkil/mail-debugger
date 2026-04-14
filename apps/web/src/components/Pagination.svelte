<script lang="ts">
  import type { Table, PaginationState } from '@tanstack/svelte-table';

  interface Props {
    table: Table<any, any>;
    pagination: PaginationState;
  }

  let { table, pagination }: Props = $props();
</script>

<div class="flex items-center justify-between text-sm text-surface-400">
  <span>{table.getRowCount()} email{table.getRowCount() !== 1 ? 's' : ''}</span>

  <div class="flex items-center gap-2">
    <button
      onclick={() => table.previousPage()}
      disabled={!table.getCanPreviousPage()}
      class="rounded px-2 py-1 hover:bg-surface-700 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      &larr;
    </button>
    <span>
      {pagination.pageIndex + 1} / {Math.max(table.getPageCount(), 1)}
    </span>
    <button
      onclick={() => table.nextPage()}
      disabled={!table.getCanNextPage()}
      class="rounded px-2 py-1 hover:bg-surface-700 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      &rarr;
    </button>

    <select
      value={pagination.pageSize}
      onchange={(e) => table.setPageSize(Number(e.currentTarget.value))}
      class="rounded border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-surface-300"
    >
      {#each [25, 50, 100] as size}
        <option value={size}>{size} / page</option>
      {/each}
    </select>
  </div>
</div>
