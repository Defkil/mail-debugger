<script lang="ts">
  import type { EmailFilter } from '$lib/types';

  interface Props {
    filter: EmailFilter;
    onchange: (filter: EmailFilter) => void;
  }

  let { filter, onchange }: Props = $props();

  let from = $state('');
  let to = $state('');
  let subject = $state('');
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function emit() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      onchange({
        from: from || undefined,
        to: to || undefined,
        subject: subject || undefined,
      });
    }, 300);
  }

  function clear() {
    from = '';
    to = '';
    subject = '';
    clearTimeout(debounceTimer);
    onchange({});
  }

  const hasFilter = $derived(!!from || !!to || !!subject);
</script>

<div class="flex flex-wrap items-center gap-3">
  <input
    type="text"
    placeholder="From"
    bind:value={from}
    oninput={emit}
    class="rounded border border-surface-700 bg-surface-800 px-3 py-1.5 text-sm text-surface-100 placeholder:text-surface-500 focus:border-primary-500 focus:outline-none"
  />
  <input
    type="text"
    placeholder="To"
    bind:value={to}
    oninput={emit}
    class="rounded border border-surface-700 bg-surface-800 px-3 py-1.5 text-sm text-surface-100 placeholder:text-surface-500 focus:border-primary-500 focus:outline-none"
  />
  <input
    type="text"
    placeholder="Subject"
    bind:value={subject}
    oninput={emit}
    class="flex-1 rounded border border-surface-700 bg-surface-800 px-3 py-1.5 text-sm text-surface-100 placeholder:text-surface-500 focus:border-primary-500 focus:outline-none"
  />
  {#if hasFilter}
    <button onclick={clear} class="text-sm text-surface-400 hover:text-surface-200">
      Clear
    </button>
  {/if}
</div>
