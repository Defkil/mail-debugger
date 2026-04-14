<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { derived } from 'svelte/store';
  import { emailDetailOptions, queryKeys } from '$lib/query';
  import { deleteEmail } from '$lib/api';
  import EmailMetadata from '../../../components/EmailMetadata.svelte';
  import EmailBodyTabs from '../../../components/EmailBodyTabs.svelte';
  import AttachmentList from '../../../components/AttachmentList.svelte';
  import ConfirmDialog from '../../../components/ConfirmDialog.svelte';
  import Button from '../../../components/ui/Button.svelte';

  const qc = useQueryClient();
  const email = createQuery(derived(page, ($p) => emailDetailOptions(Number($p.params.id))));
  const id = $derived(Number($page.params.id));

  let showDelete = $state(false);

  async function handleDelete() {
    showDelete = false;
    await deleteEmail(id);
    qc.invalidateQueries({ queryKey: queryKeys.emails.all });
    qc.invalidateQueries({ queryKey: queryKeys.health });
    goto('/');
  }
</script>

<div class="mx-auto flex max-w-4xl flex-col gap-6">
  <div class="flex items-center justify-between">
    <Button variant="ghost" onclick={() => goto('/')}>
      &larr; Back
    </Button>
    <Button variant="danger" onclick={() => (showDelete = true)}>
      Delete
    </Button>
  </div>

  {#if $email.isLoading}
    <div class="py-12 text-center text-surface-500">Loading...</div>
  {:else if $email.isError}
    <div class="py-12 text-center text-danger-500">
      {$email.error.message}
    </div>
  {:else if $email.data}
    <EmailMetadata email={$email.data} />
    <EmailBodyTabs email={$email.data} />
    <AttachmentList attachments={$email.data.attachments} />
  {/if}
</div>

<ConfirmDialog
  open={showDelete}
  title="Delete email"
  message="This will permanently delete this email."
  onconfirm={handleDelete}
  oncancel={() => (showDelete = false)}
/>
