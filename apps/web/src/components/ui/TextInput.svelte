<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends HTMLInputAttributes {
    value?: string;
  }

  let { value = $bindable(''), class: extraClass, ...rest }: Props = $props();
</script>

<input
  type="text"
  bind:value
  class="rounded border border-surface-700 bg-surface-800 px-3 py-1.5 text-sm text-surface-100 placeholder:text-surface-500 focus:border-primary-500 focus:outline-none {extraClass ?? ''}"
  {...rest}
/>
