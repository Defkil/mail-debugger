<script lang="ts">
  import { FlexRender, createTableState } from '@tanstack/svelte-table';
  import type { SortingState, PaginationState } from '@tanstack/svelte-table';
  import { goto } from '$app/navigation';
  import { createAppTable } from '$lib/table';
  import { columns } from '$lib/columns';
  import type { EmailSummary } from '@mail-debugger/types';
  import Pagination from './Pagination.svelte';

  interface Props {
    data: EmailSummary[];
    total: number;
    pagination: PaginationState;
    onpaginationchange: (pagination: PaginationState) => void;
  }

  let { data, total, pagination, onpaginationchange }: Props = $props();

  const [sorting, setSorting] = createTableState<SortingState>([
    { id: 'receivedAt', desc: true },
  ]);

  const table = createAppTable({
    get data() {
      return data;
    },
    columns,
    manualPagination: true,
    get rowCount() {
      return total;
    },
    state: {
      get sorting() {
        return sorting();
      },
      get pagination() {
        return pagination;
      },
    },
    onSortingChange: setSorting,
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function' ? updater(pagination) : updater;
      onpaginationchange(next);
    },
  });
</script>

<div class="flex flex-col gap-3">
  <div class="border-surface-700 overflow-x-auto rounded-lg border">
    <table class="w-full text-left text-sm">
      <thead
        class="border-surface-700 bg-surface-800/50 text-surface-400 border-b text-xs uppercase"
      >
        {#each table.getHeaderGroups() as headerGroup}
          <tr>
            {#each headerGroup.headers as header}
              <th
                class="px-4 py-3 font-medium"
                class:cursor-pointer={header.column.getCanSort()}
                onclick={header.column.getToggleSortingHandler()}
                style="width: {header.getSize()}px"
              >
                <div class="flex items-center gap-1">
                  <FlexRender {header} />
                  {#if header.column.getIsSorted() === 'asc'}↑
                  {:else if header.column.getIsSorted() === 'desc'}↓
                  {/if}
                </div>
              </th>
            {/each}
          </tr>
        {/each}
      </thead>
      <tbody>
        {#each table.getRowModel().rows as row}
          <tr
            class="border-surface-800 hover:bg-surface-800/70 cursor-pointer border-b"
            onclick={() => goto(`/emails/${row.original.id}`)}
          >
            {#each row.getVisibleCells() as cell}
              <td
                class="truncate px-4 py-3"
                style="max-width: {cell.column.getSize()}px"
              >
                <FlexRender {cell} />
              </td>
            {/each}
          </tr>
        {:else}
          <tr>
            <td
              colspan={columns.length}
              class="px-4 py-12 text-center text-surface-500"
            >
              No emails yet. Send one to the SMTP server to get started.
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <Pagination {table} {pagination} />
</div>
