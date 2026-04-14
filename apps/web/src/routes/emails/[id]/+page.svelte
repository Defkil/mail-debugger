<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { derived } from 'svelte/store';
  import { emailDetailOptions, queryKeys } from '$lib/query';
  import { deleteEmail } from '$lib/api';
  import { formatDate, formatBytes } from '$lib/format';
  import HtmlPreview from '../../../components/HtmlPreview.svelte';
  import ConfirmDialog from '../../../components/ConfirmDialog.svelte';

  const qc = useQueryClient();
  const email = createQuery(derived(page, ($p) => emailDetailOptions(Number($p.params.id))));

  const id = $derived(Number($page.params.id));

  let showDelete = $state(false);
  let activeTab: 'text' | 'html' | 'headers' | 'raw' = $state('text');

  async function handleDelete() {
    showDelete = false;
    await deleteEmail(id);
    qc.invalidateQueries({ queryKey: queryKeys.emails.all });
    qc.invalidateQueries({ queryKey: queryKeys.health });
    goto('/');
  }

  function downloadAttachment(filename: string | null, contentType: string, content: string) {
    const bytes = Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? 'attachment';
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="mx-auto flex max-w-4xl flex-col gap-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <button onclick={() => goto('/')} class="text-sm text-surface-400 hover:text-surface-200">
      &larr; Back
    </button>
    <button
      onclick={() => (showDelete = true)}
      class="rounded bg-danger-600 px-4 py-1.5 text-sm text-white hover:bg-danger-500"
    >
      Delete
    </button>
  </div>

  {#if $email.isLoading}
    <div class="py-12 text-center text-surface-500">Loading...</div>
  {:else if $email.isError}
    <div class="py-12 text-center text-danger-500">
      {$email.error.message}
    </div>
  {:else if $email.data}
    {@const e = $email.data}

    <!-- Metadata -->
    <div class="rounded-lg border border-surface-700 bg-surface-800/50 p-5">
      <h1 class="mb-4 text-xl font-semibold">{e.subject}</h1>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt class="text-surface-400">From</dt>
        <dd>{e.from}</dd>
        <dt class="text-surface-400">To</dt>
        <dd>{e.to.join(', ')}</dd>
        {#if e.cc.length}
          <dt class="text-surface-400">CC</dt>
          <dd>{e.cc.join(', ')}</dd>
        {/if}
        {#if e.bcc.length}
          <dt class="text-surface-400">BCC</dt>
          <dd>{e.bcc.join(', ')}</dd>
        {/if}
        <dt class="text-surface-400">Date</dt>
        <dd>{formatDate(e.receivedAt)}</dd>
        {#if e.messageId}
          <dt class="text-surface-400">Message-ID</dt>
          <dd class="break-all font-mono text-xs">{e.messageId}</dd>
        {/if}
      </dl>
    </div>

    <!-- Tabs -->
    <div>
      <div class="flex gap-1 border-b border-surface-700">
        {#each ['text', 'html', 'headers', 'raw'] as tab}
          <button
            onclick={() => (activeTab = tab as typeof activeTab)}
            class="border-b-2 px-4 py-2 text-sm transition-colors {activeTab === tab
              ? 'border-primary-500 text-primary-400'
              : 'border-transparent text-surface-400 hover:text-surface-200'}"
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        {/each}
      </div>

      <div class="mt-4">
        {#if activeTab === 'text'}
          {#if e.textBody}
            <pre class="whitespace-pre-wrap rounded-lg border border-surface-700 bg-surface-800/50 p-4 text-sm">{e.textBody}</pre>
          {:else}
            <p class="text-surface-500">No plain text body</p>
          {/if}
        {:else if activeTab === 'html'}
          {#if e.htmlBody}
            <HtmlPreview html={e.htmlBody} />
          {:else}
            <p class="text-surface-500">No HTML body</p>
          {/if}
        {:else if activeTab === 'headers'}
          <div class="rounded-lg border border-surface-700 bg-surface-800/50">
            <table class="w-full text-sm">
              <tbody>
                {#each Object.entries(e.headers) as [key, value]}
                  <tr class="border-b border-surface-700/50 last:border-0">
                    <td class="px-4 py-2 font-mono text-xs text-surface-400">{key}</td>
                    <td class="break-all px-4 py-2 font-mono text-xs">{value}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else if activeTab === 'raw'}
          <pre class="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-surface-700 bg-surface-800/50 p-4 font-mono text-xs">{e.raw}</pre>
        {/if}
      </div>
    </div>

    <!-- Attachments -->
    {#if e.attachments.length > 0}
      <div>
        <h2 class="mb-3 text-sm font-semibold text-surface-300">
          Attachments ({e.attachments.length})
        </h2>
        <div class="flex flex-col gap-2">
          {#each e.attachments as att}
            <button
              onclick={() => downloadAttachment(att.filename, att.contentType, att.content)}
              class="flex items-center justify-between rounded-lg border border-surface-700 bg-surface-800/50 px-4 py-3 text-left text-sm hover:border-surface-600"
            >
              <span>{att.filename ?? 'unnamed'}</span>
              <span class="text-surface-500">{att.contentType} &middot; {formatBytes(att.size)}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

<ConfirmDialog
  open={showDelete}
  title="Delete email"
  message="This will permanently delete this email."
  onconfirm={handleDelete}
  oncancel={() => (showDelete = false)}
/>
