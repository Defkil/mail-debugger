<script lang="ts">
  import type { AttachmentMeta } from '$lib/types';
  import { formatBytes } from '$lib/format';

  interface Props {
    attachments: AttachmentMeta[];
  }

  let { attachments }: Props = $props();

  function download(att: AttachmentMeta) {
    const bytes = Uint8Array.from(atob(att.content), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: att.contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.filename ?? 'attachment';
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

{#if attachments.length > 0}
  <div>
    <h2 class="mb-3 text-sm font-semibold text-surface-300">
      Attachments ({attachments.length})
    </h2>
    <div class="flex flex-col gap-2">
      {#each attachments as att}
        <button
          onclick={() => download(att)}
          class="flex items-center justify-between rounded-lg border border-surface-700 bg-surface-800/50 px-4 py-3 text-left text-sm hover:border-surface-600"
        >
          <span>{att.filename ?? 'unnamed'}</span>
          <span class="text-surface-500">{att.contentType} &middot; {formatBytes(att.size)}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}
