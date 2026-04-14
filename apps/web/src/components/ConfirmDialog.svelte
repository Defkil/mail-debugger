<script lang="ts">
  interface Props {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    onconfirm: () => void;
    oncancel: () => void;
  }

  let { open, title, message, confirmLabel = 'Delete', onconfirm, oncancel }: Props = $props();
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    onkeydown={(e) => e.key === 'Escape' && oncancel()}
  >
    <div class="w-full max-w-sm rounded-lg border border-surface-700 bg-surface-800 p-6 shadow-xl">
      <h3 class="mb-2 text-lg font-semibold text-surface-100">{title}</h3>
      <p class="mb-6 text-sm text-surface-400">{message}</p>
      <div class="flex justify-end gap-3">
        <button
          onclick={oncancel}
          class="rounded px-4 py-2 text-sm text-surface-300 hover:bg-surface-700"
        >
          Cancel
        </button>
        <button
          onclick={onconfirm}
          class="rounded bg-danger-600 px-4 py-2 text-sm text-white hover:bg-danger-500"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}
