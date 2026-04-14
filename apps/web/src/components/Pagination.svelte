<script lang="ts">
  import type { Table, PaginationState } from '@tanstack/svelte-table';
  import Button from './ui/Button.svelte';

  interface Props {
    table: Table<any, any>;
    pagination: PaginationState;
  }

  let { table, pagination }: Props = $props();
</script>

<div class="text-surface-400 flex items-center justify-between text-sm">
  <span>{table.getRowCount()} email{table.getRowCount() !== 1 ? 's' : ''}</span>

  <div class="flex items-center gap-2">
    <Button
      variant="secondary"
      onclick={() => table.previousPage()}
      disabled={!table.getCanPreviousPage()}
      class="px-2 py-1 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      &larr;
    </Button>
    <span>
      {pagination.pageIndex + 1} / {Math.max(table.getPageCount(), 1)}
    </span>
    <Button
      variant="secondary"
      onclick={() => table.nextPage()}
      disabled={!table.getCanNextPage()}
      class="px-2 py-1 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      &rarr;
    </Button>

    <select
      value={pagination.pageSize}
      onchange={(e) => table.setPageSize(Number(e.currentTarget.value))}
      class="border-surface-700 bg-surface-800 text-surface-300 rounded border px-2 py-1 text-sm"
    >
      {#each [25, 50, 100] as size}
        <option value={size}>{size} / page</option>
      {/each}
    </select>
  </div>
</div>
