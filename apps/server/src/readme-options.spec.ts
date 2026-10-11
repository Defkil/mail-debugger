import fs from 'node:fs';
import path from 'node:path';
import { serverOptionRows, type OptionRow } from './config.js';

// The option tables of the README files are made from the same rows as
// `--help`. To rewrite them after changing an option, run
//   UPDATE_README_TABLES=1 pnpm nx test @mail-debugger/server

const root = path.resolve(import.meta.dirname, '../../..');
const START = '<!-- server-options:start -->';
const END = '<!-- server-options:end -->';
const README_FILES = [
  { file: 'README.md', withWeb: true },
  { file: 'packages/api/README.md', withWeb: false },
];

const code = (text: string) => `\`${text.replaceAll('|', String.raw`\|`)}\``;

function cells(row: OptionRow): string[] {
  return [
    row.short ? `${code(row.short)}, ${code(row.flag)}` : code(row.flag),
    row.default === undefined ? '' : code(row.default),
    row.description.replaceAll('|', String.raw`\|`),
  ];
}

/** A Markdown table laid out the way Prettier formats it. */
function markdownTable(rows: string[][]): string {
  const all = [['Option', 'Default', 'Description'], ...rows];
  const widths = all[0].map((_, column) =>
    Math.max(3, ...all.map((row) => row[column].length)),
  );
  const line = (row: string[]) =>
    `| ${row.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`;
  return [
    line(all[0]),
    line(widths.map((width) => '-'.repeat(width))),
    ...rows.map((row) => line(row)),
  ].join('\n');
}

/** The text before the table, the table and the text after it. */
function splitAtTable(text: string, file: string): [string, string, string] {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start === -1 || end < start) {
    throw new Error(`${file} lacks the ${START} ... ${END} markers`);
  }
  return [
    text.slice(0, start + START.length),
    text.slice(start + START.length, end).trim(),
    text.slice(end),
  ];
}

/** The cells of a Markdown table, without the header and separator rows. */
function parseTable(table: string): string[][] {
  return table
    .split('\n')
    .slice(2)
    .map((line) =>
      line
        .trim()
        .replaceAll(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim()),
    );
}

describe('README option tables', () => {
  it.each(README_FILES)(
    '$file lists every server option as --help does',
    ({ file, withWeb }) => {
      const full = path.join(root, file);
      const [before, table, after] = splitAtTable(
        fs.readFileSync(full, 'utf8'),
        file,
      );
      const expected = serverOptionRows(withWeb).map((row) => cells(row));
      if (process.env['UPDATE_README_TABLES']) {
        const updated = markdownTable(expected);
        fs.writeFileSync(full, `${before}\n\n${updated}\n\n${after}`, 'utf8');
        return;
      }
      expect(parseTable(table)).toEqual(expected);
    },
  );
});
