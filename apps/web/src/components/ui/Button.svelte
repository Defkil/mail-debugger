<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type Variant = 'danger' | 'ghost' | 'secondary';

  interface Props extends HTMLButtonAttributes {
    variant?: Variant;
    children: Snippet;
  }

  let { variant = 'secondary', children, class: extraClass, ...rest }: Props = $props();

  const variants: Record<Variant, string> = {
    danger: 'rounded bg-danger-600 px-4 py-1.5 text-sm text-white hover:bg-danger-500',
    ghost: 'text-sm text-surface-400 hover:text-surface-200',
    secondary: 'rounded px-4 py-1.5 text-sm text-surface-300 hover:bg-surface-700',
  };
</script>

<button class="{variants[variant]} {extraClass ?? ''}" {...rest}>
  {@render children()}
</button>
