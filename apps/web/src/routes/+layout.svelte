<script lang="ts">
  import { QueryClientProvider } from '@tanstack/svelte-query';
  import { queryClient } from '$lib/query';
  import HealthBadge from '../components/HealthBadge.svelte';
  import ThemeToggle from '../components/ThemeToggle.svelte';
  import '../app.css';

  let { children } = $props();
</script>

<QueryClientProvider client={queryClient}>
  <div class="bg-surface-950 text-surface-100 flex min-h-screen flex-col">
    <nav
      class="border-surface-800 flex items-center justify-between border-b px-6 py-3"
    >
      <a href="/" class="text-primary-500 text-lg font-semibold"
        >Mail Debugger</a
      >
      <div class="flex items-center gap-3">
        <HealthBadge />
        <ThemeToggle />
      </div>
    </nav>
    <main class="flex-1 p-6">
      {@render children()}
    </main>
  </div>
</QueryClientProvider>
