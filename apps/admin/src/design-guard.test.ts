import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildThemeCss } from '@runsphere/ui';

const walk = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

const sources = walk('src').filter(
  (path) => /\.(tsx?|css)$/.test(path) && !/\.test\.tsx?$/.test(path)
);

describe('admin design guard (ADR-0016)', () => {
  // The admin has no colours of its own. Everything comes from @runsphere/ui,
  // so changing a token changes both apps and both themes together.
  it('has no colour literal outside @runsphere/ui', () => {
    const offenders = sources.filter((path) =>
      /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(readFileSync(path, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });

  it('uses only custom properties that the token bridge defines', () => {
    const defined = new Set([...buildThemeCss().matchAll(/(--rs-[a-z0-9-]+):/g)].map((m) => m[1]));
    const missing = new Set<string>();
    for (const path of sources.filter((file) => file.endsWith('.css')))
      for (const [, name] of readFileSync(path, 'utf8').matchAll(/var\((--rs-[a-z0-9-]+)/g))
        if (!defined.has(name!)) missing.add(`${path}: ${name}`);
    expect([...missing]).toEqual([]);
  });

  it('retires the heavy font weights', () => {
    const offenders = sources.filter((path) =>
      /font-weight:\s*(800|900|bold|bolder)\b/.test(readFileSync(path, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });
});
