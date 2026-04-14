<script lang="ts">
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { writable, derived } from 'svelte/store';
  import { emailListOptions, queryKeys } from '$lib/query';
  import { deleteAllEmails } from '$lib/api';
  import type { EmailFilter } from '$lib/types';
  import EmailTable from '../components/EmailTable.svelte';
  import FilterBar from '../components/FilterBar.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';

  let filter: EmailFilter = $state({});
  let showDeleteAll = $state(false);

  // Bridge $state → Svelte store for createQuery compatibility
  const filterStore = writable<EmailFilter>({});
  $effect(() => {
    filterStore.set(filter);
  });

  const qc = useQueryClient();
  const emails = createQuery(derived(filterStore, (f) => emailListOptions(f)));

  async function handleDeleteAll() {
    showDeleteAll = false;
    await deleteAllEmails();
    qc.invalidateQueries({ queryKey: queryKeys.emails.all });
    qc.invalidateQueries({ queryKey: queryKeys.health });
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex items-center justify-between gap-4">
    <div class="flex-1">
      <FilterBar {filter} onchange={(f) => (filter = f)} />
    </div>
    {#if $emails.data?.length}
      <button
        onclick={() => (showDeleteAll = true)}
        class="shrink-0 rounded bg-danger-600 px-4 py-1.5 text-sm text-white hover:bg-danger-500"
      >
        Delete All
      </button>
    {/if}
  </div>

  {#if $emails.isLoading}
    <div class="py-12 text-center text-surface-500">Loading...</div>
  {:else if $emails.isError}
    <div class="py-12 text-center text-danger-500">
      Failed to load emails: {$emails.error.message}
    </div>
  {:else if $emails.data}
    <EmailTable data={$emails.data} />
  {/if}
</div>

<ConfirmDialog
  open={showDeleteAll}
  title="Delete all emails"
  message="This will permanently delete all captured emails. This cannot be undone."
  onconfirm={handleDeleteAll}
  oncancel={() => (showDeleteAll = false)}
/>
