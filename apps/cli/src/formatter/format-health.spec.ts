import { formatHealth } from './format-health.js';
import type { HealthResponse } from '@mail-debugger/client';

describe('formatHealth', () => {
  it('should format all health fields', () => {
    const health: HealthResponse = {
      status: 'ok',
      smtpPort: 1025,
      apiPort: 3000,
      persistent: false,
      emailCount: 42,
    };

    const output = formatHealth(health);

    expect(output).toContain('Status:      ok');
    expect(output).toContain('SMTP Port:   1025');
    expect(output).toContain('API Port:    3000');
    expect(output).toContain('Persistent:  false');
    expect(output).toContain('Email Count: 42');
  });
});
