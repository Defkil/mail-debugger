import type { HealthResponse } from '@mail-debugger/types';

export function formatHealth(health: HealthResponse): string {
  return [
    `Status:      ${health.status}`,
    `SMTP Port:   ${health.smtpPort}`,
    `API Port:    ${health.apiPort}`,
    `Persistent:  ${health.persistent}`,
    `Email Count: ${health.emailCount}`,
  ].join('\n');
}
