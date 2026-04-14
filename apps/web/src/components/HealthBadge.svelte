<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { healthOptions } from '$lib/query';

  const health = createQuery(healthOptions());
</script>

<div class="flex items-center gap-2 text-sm">
  {#if $health.isLoading}
    <span class="inline-block h-2.5 w-2.5 rounded-full bg-warning-500"></span>
    <span class="text-surface-400">connecting…</span>
  {:else if $health.isError}
    <span class="inline-block h-2.5 w-2.5 rounded-full bg-danger-500"></span>
    <span class="text-danger-500">offline</span>
  {:else if $health.data}
    <span class="inline-block h-2.5 w-2.5 rounded-full bg-success-500"></span>
    <span class="text-surface-400">
      SMTP :{$health.data.smtpPort} · API :{$health.data.apiPort}
      {#if $health.data.persistent}· persistent{/if}
      · {$health.data.emailCount} email{$health.data.emailCount !== 1 ? 's' : ''}
    </span>
  {/if}
</div>
