<script lang="ts">
  import { QueryClientProvider } from '@tanstack/svelte-query';
  import { queryClient } from '$lib/query';
  import HealthBadge from '../components/HealthBadge.svelte';
  import '../app.css';

  let { children } = $props();
</script>

<QueryClientProvider client={queryClient}>
  <div class="flex min-h-screen flex-col bg-surface-950 text-surface-100">
    <nav class="flex items-center justify-between border-b border-surface-800 px-6 py-3">
      <a href="/" class="text-lg font-semibold text-primary-500">Mail Debugger</a>
      <HealthBadge />
    </nav>
    <main class="flex-1 p-6">
      {@render children()}
    </main>
  </div>
</QueryClientProvider>
