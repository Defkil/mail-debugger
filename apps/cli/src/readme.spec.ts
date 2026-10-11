import fs from 'node:fs';
import path from 'node:path';
import { formatHelp } from './config/parse-config.js';
import { COMMAND_NAMES } from './config/types.js';

const root = path.resolve(import.meta.dirname, '../../..');

describe('packages/cli/README.md', () => {
  const readme = fs.readFileSync(
    path.join(root, 'packages/cli/README.md'),
    'utf8',
  );

  it('documents every option of --help', () => {
    const options = new Set(
      formatHelp('mail-debugger-cli').match(/--[a-z-]+/g),
    );
    expect(options.size).toBeGreaterThan(10);
    for (const option of options) expect(readme).toContain(`\`${option}`);
  });

  it('documents every command', () => {
    for (const command of COMMAND_NAMES) {
      expect(readme).toMatch(new RegExp(`^\\| \`${command}[ \`]`, 'm'));
    }
  });
});
