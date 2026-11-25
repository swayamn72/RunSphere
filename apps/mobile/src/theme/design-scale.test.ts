import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { typeScale } from '@runsphere/ui';

const sources = (): string[] => {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return walk(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
  return [...walk('src'), 'App.tsx'];
};

const offenders = (pattern: RegExp, skip: (path: string) => boolean = () => false) =>
  sources()
    .filter((path) => !skip(path))
    .filter((path) => pattern.test(readFileSync(path, 'utf8')));

describe('type system guard (ADR-0016)', () => {
  it('uses only the four weights', () => {
    expect(offenders(/fontWeight: ?['"](800|900)['"]/)).toEqual([]);
  });

  it('draws text through the Inter-aware Text, never React Native’s directly', () => {
    // components/Text.tsx is the one place allowed to import the native ones.
    const direct = /import\s*\{[^}]*\b(Text|TextInput)\b[^}]*\}\s*from\s*'react-native';/;
    expect(offenders(direct, (path) => path.endsWith('components/Text.tsx'))).toEqual([]);
  });

  it('uses only font sizes from the scale', () => {
    // The scale, plus the 14 px body-small role, a hidden 1 px live region and
    // the 112 px decorative glyph on the Turf illustration.
    const allowed = new Set<number>([...Object.values(typeScale).map((role) => role.size), 1, 112]);
    const stray = new Set<string>();
    for (const path of sources())
      for (const [, size] of readFileSync(path, 'utf8').matchAll(/fontSize: ?(\d+)/g))
        if (!allowed.has(Number(size))) stray.add(`${path}: ${size}`);
    expect([...stray]).toEqual([]);
  });
});
