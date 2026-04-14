<script lang="ts">
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { writable, derived } from 'svelte/store';
  import type { PaginationState } from '@tanstack/svelte-table';
  import { emailListOptions, queryKeys } from '$lib/query';
  import { api } from '$lib/api';
  import type { EmailFilter } from '@mail-debugger/types';
  import EmailTable from '../components/EmailTable.svelte';
  import FilterBar from '../components/FilterBar.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import Button from '../components/ui/Button.svelte';

  let filter: EmailFilter = $state({});
  let pagination: PaginationState = $state({ pageIndex: 0, pageSize: 25 });
  let showDeleteAll = $state(false);

  const paramsStore = writable({
    filter: {} as EmailFilter,
    pagination: { pageIndex: 0, pageSize: 25 },
  });
  $effect(() => {
    paramsStore.set({ filter, pagination });
  });

  const qc = useQueryClient();
  const emails = createQuery(
    derived(paramsStore, ({ filter: f, pagination: p }) =>
      emailListOptions(f, p.pageSize, p.pageIndex * p.pageSize),
    ),
  );

  function onFilterChange(f: EmailFilter) {
    filter = f;
    pagination = { ...pagination, pageIndex: 0 };
  }

  async function handleDeleteAll() {
    showDeleteAll = false;
    await api.deleteAllEmails();
    pagination = { ...pagination, pageIndex: 0 };
    qc.invalidateQueries({ queryKey: queryKeys.emails.all });
    qc.invalidateQueries({ queryKey: queryKeys.health });
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex items-center justify-between gap-4">
    <div class="flex-1">
      <FilterBar onchange={onFilterChange} />
    </div>
    {#if $emails.data && $emails.data.total > 0}
      <Button
        variant="danger"
        class="shrink-0"
        onclick={() => (showDeleteAll = true)}
      >
        Delete All
      </Button>
    {/if}
  </div>

  {#if $emails.isLoading}
    <div class="text-surface-500 py-12 text-center">Loading...</div>
  {:else if $emails.isError}
    <div class="text-danger-500 py-12 text-center">
      Failed to load emails: {$emails.error.message}
    </div>
  {:else if $emails.data}
    <EmailTable
      data={$emails.data.data}
      total={$emails.data.total}
      {pagination}
      onpaginationchange={(p) => (pagination = p)}
    />
  {/if}
</div>

<ConfirmDialog
  open={showDeleteAll}
  title="Delete all emails"
  message="This will permanently delete all captured emails. This cannot be undone."
  onconfirm={handleDeleteAll}
  oncancel={() => (showDeleteAll = false)}
/>
