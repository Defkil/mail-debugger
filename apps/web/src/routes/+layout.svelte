<script lang="ts">
  import { createQuery, QueryClientProvider } from '@tanstack/svelte-query';
  import { resolve } from '$app/paths';
  import { healthOptions, isUnauthorized, queryClient } from '#lib/query';
  import HealthBadge from '../components/HealthBadge.svelte';
  import ThemeToggle from '../components/ThemeToggle.svelte';
  import TokenLogin from '../components/TokenLogin.svelte';
  import '../app.css';

  let { children } = $props();

  // The health check also tells whether the server requires an API token.
  const health = createQuery(
    () => healthOptions(),
    () => queryClient,
  );
</script>

<QueryClientProvider client={queryClient}>
  <div class="bg-surface-950 text-surface-100 flex min-h-screen flex-col">
    <nav
      class="border-surface-800 flex items-center justify-between border-b px-6 py-3"
    >
      <a href={resolve('/')} class="text-primary-500 text-lg font-semibold"
        >Mail Debugger</a
      >
      <div class="flex items-center gap-3">
        <HealthBadge />
        <ThemeToggle />
      </div>
    </nav>
    <main class="flex-1 p-6">
      {#if isUnauthorized(health.error)}
        <TokenLogin checking={health.isFetching} />
      {:else}
        {@render children()}
      {/if}
    </main>
  </div>
</QueryClientProvider>
