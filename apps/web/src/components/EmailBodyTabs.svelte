<script lang="ts">
  import type { Email } from '$lib/types';
  import HtmlPreview from './HtmlPreview.svelte';

  interface Props {
    email: Email;
  }

  let { email }: Props = $props();

  type Tab = 'text' | 'html' | 'headers' | 'raw';
  const tabs: Tab[] = ['text', 'html', 'headers', 'raw'];
  let activeTab: Tab = $state('text');
</script>

<div>
  <div class="flex gap-1 border-b border-surface-700">
    {#each tabs as tab}
      <button
        onclick={() => (activeTab = tab)}
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
      {#if email.textBody}
        <pre class="whitespace-pre-wrap rounded-lg border border-surface-700 bg-surface-800/50 p-4 text-sm">{email.textBody}</pre>
      {:else}
        <p class="text-surface-500">No plain text body</p>
      {/if}
    {:else if activeTab === 'html'}
      {#if email.htmlBody}
        <HtmlPreview html={email.htmlBody} />
      {:else}
        <p class="text-surface-500">No HTML body</p>
      {/if}
    {:else if activeTab === 'headers'}
      <div class="rounded-lg border border-surface-700 bg-surface-800/50">
        <table class="w-full text-sm">
          <tbody>
            {#each Object.entries(email.headers) as [key, value]}
              <tr class="border-b border-surface-700/50 last:border-0">
                <td class="px-4 py-2 font-mono text-xs text-surface-400">{key}</td>
                <td class="break-all px-4 py-2 font-mono text-xs">{value}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if activeTab === 'raw'}
      <pre class="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-surface-700 bg-surface-800/50 p-4 font-mono text-xs">{email.raw}</pre>
    {/if}
  </div>
</div>
