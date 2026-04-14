<script lang="ts">
  import type { EmailFilter } from '@mail-debugger/types';
  import Button from './ui/Button.svelte';
  import TextInput from './ui/TextInput.svelte';

  interface Props {
    onchange: (filter: EmailFilter) => void;
  }

  let { onchange }: Props = $props();

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
  <TextInput placeholder="From" bind:value={from} oninput={emit} />
  <TextInput placeholder="To" bind:value={to} oninput={emit} />
  <TextInput
    placeholder="Subject"
    bind:value={subject}
    oninput={emit}
    class="flex-1"
  />
  {#if hasFilter}
    <Button variant="ghost" onclick={clear}>Clear</Button>
  {/if}
</div>
