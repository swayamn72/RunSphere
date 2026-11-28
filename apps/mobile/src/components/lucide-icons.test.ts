import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lucideIcons } from './lucide-icons';

const folder = 'assets/icons/lucide';
const files = readdirSync(folder).filter((file) => file.endsWith('.svg'));

describe('Lucide icons', () => {
  it('ships the licence beside the files', () => {
    expect(readFileSync(`${folder}/LICENSE`, 'utf8')).toContain('ISC License');
  });

  it('has exactly one generated entry per SVG file', () => {
    expect(Object.keys(lucideIcons).sort()).toEqual(files.map((f) => f.slice(0, -4)).sort());
  });

  it.each(files)('%s matches what the app draws (run scripts/generate-icons.mjs)', (file) => {
    const svg = readFileSync(`${folder}/${file}`, 'utf8');
    const body = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1);
    const inFile = [...body.matchAll(/<([a-z]+)\s([^>]*?)\/>/g)].map(([, tag, attributes]) => ({
      tag,
      attributes: Object.fromEntries(
        [...attributes!.matchAll(/([a-zA-Z0-9-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])
      )
    }));
    expect(inFile.length).toBeGreaterThan(0);
    expect(lucideIcons[file.slice(0, -4) as keyof typeof lucideIcons]).toEqual(inFile);
  });
});
