<script lang="ts">
  import Button from './ui/Button.svelte';

  interface Props {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    onconfirm: () => void;
    oncancel: () => void;
  }

  let {
    open,
    title,
    message,
    confirmLabel = 'Delete',
    onconfirm,
    oncancel,
  }: Props = $props();
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    onkeydown={(e) => e.key === 'Escape' && oncancel()}
  >
    <div
      class="border-surface-700 bg-surface-800 w-full max-w-sm rounded-lg border p-6 shadow-xl"
    >
      <h3 class="text-surface-100 mb-2 text-lg font-semibold">{title}</h3>
      <p class="text-surface-400 mb-6 text-sm">{message}</p>
      <div class="flex justify-end gap-3">
        <Button variant="secondary" onclick={oncancel}>Cancel</Button>
        <Button variant="danger" onclick={onconfirm}>{confirmLabel}</Button>
      </div>
    </div>
  </div>
{/if}
