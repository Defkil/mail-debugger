<script lang="ts">
  interface Props {
    html: string;
  }

  let { html }: Props = $props();
  let iframe: HTMLIFrameElement | undefined = $state();

  function resize() {
    if (iframe?.contentDocument) {
      iframe.style.height =
        iframe.contentDocument.documentElement.scrollHeight + 'px';
    }
  }
</script>

<iframe
  bind:this={iframe}
  srcdoc={html}
  sandbox="allow-same-origin"
  onload={resize}
  title="Email HTML preview"
  class="border-surface-700 w-full rounded border bg-white"
  style="min-height: 200px"
></iframe>
