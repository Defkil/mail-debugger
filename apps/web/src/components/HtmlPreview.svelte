<script lang="ts">
  import { buildPreviewDocument, hasRemoteImages } from '#lib/html-preview';
  import Button from './ui/Button.svelte';

  interface Props {
    html: string;
  }

  let { html }: Props = $props();
  let iframe: HTMLIFrameElement | undefined = $state();
  let approvedHtml: string | undefined = $state();
  const allowRemoteImages = $derived(approvedHtml === html);

  const remoteImages = $derived(hasRemoteImages(html));
  // Captured mail is untrusted: the sandbox runs no scripts, forms or
  // navigation of the app, and the injected policy blocks network requests.
  const srcdoc = $derived(buildPreviewDocument(html, { allowRemoteImages }));

  function resize() {
    if (iframe?.contentDocument) {
      iframe.style.height =
        iframe.contentDocument.documentElement.scrollHeight + 'px';
    }
  }
</script>

{#if remoteImages && !allowRemoteImages}
  <div
    class="border-surface-700 text-surface-400 mb-2 flex items-center justify-between rounded border px-3 py-2 text-sm"
  >
    <span>Remote images are blocked.</span>
    <Button variant="ghost" onclick={() => (approvedHtml = html)}>
      Load remote images
    </Button>
  </div>
{/if}
<iframe
  bind:this={iframe}
  {srcdoc}
  sandbox="allow-same-origin"
  referrerpolicy="no-referrer"
  onload={resize}
  title="Email HTML preview"
  class="border-surface-700 w-full rounded border bg-white"
  style="min-height: 200px"
></iframe>
