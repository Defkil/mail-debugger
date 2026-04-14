<script lang="ts">
  import type { Email } from '$lib/types';
  import { formatDate } from '$lib/format';

  interface Props {
    email: Email;
  }

  let { email }: Props = $props();
</script>

<div class="rounded-lg border border-surface-700 bg-surface-800/50 p-5">
  <h1 class="mb-4 text-xl font-semibold">{email.subject}</h1>
  <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
    <dt class="text-surface-400">From</dt>
    <dd>{email.from}</dd>
    <dt class="text-surface-400">To</dt>
    <dd>{email.to.join(', ')}</dd>
    {#if email.cc.length}
      <dt class="text-surface-400">CC</dt>
      <dd>{email.cc.join(', ')}</dd>
    {/if}
    {#if email.bcc.length}
      <dt class="text-surface-400">BCC</dt>
      <dd>{email.bcc.join(', ')}</dd>
    {/if}
    <dt class="text-surface-400">Date</dt>
    <dd>{formatDate(email.receivedAt)}</dd>
    {#if email.messageId}
      <dt class="text-surface-400">Message-ID</dt>
      <dd class="break-all font-mono text-xs">{email.messageId}</dd>
    {/if}
  </dl>
</div>
