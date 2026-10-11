<script lang="ts">
  import { useQueryClient } from '@tanstack/svelte-query';
  import { setApiToken } from '#lib/api';
  import Button from './ui/Button.svelte';
  import TextInput from './ui/TextInput.svelte';

  interface Props {
    /** True while the server checks a submitted token. */
    checking: boolean;
  }

  let { checking }: Props = $props();

  const queryClient = useQueryClient();
  let value = $state('');
  let rejected = $state(false);

  function submit(event: SubmitEvent) {
    event.preventDefault();
    setApiToken(value);
    value = '';
    // Shown if the form is still here after the retry: the token was wrong.
    rejected = true;
    void queryClient.invalidateQueries();
  }
</script>

<form class="mx-auto mt-16 flex max-w-sm flex-col gap-3" onsubmit={submit}>
  <h2 class="text-surface-100 text-lg font-semibold">API token required</h2>
  <p class="text-surface-400 text-sm">
    This server was started with MAIL_DEBUGGER_API_TOKEN. Enter the token to
    open the inbox; it stays in this tab's memory only.
  </p>
  <TextInput
    type="password"
    bind:value
    autocomplete="off"
    aria-label="API token"
    required
  />
  {#if rejected && !checking}
    <p class="text-danger-500 text-sm" role="alert">
      The server did not accept the token.
    </p>
  {/if}
  <Button type="submit" class="bg-surface-800 self-end">Open inbox</Button>
</form>
