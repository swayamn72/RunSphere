import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { radius, space, typeScale } from '@runsphere/ui';

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
    expect(offenders(direct, (path) => path.endsWith(join('components', 'Text.tsx')))).toEqual([]);
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

  it('spells a spacing or radius that is on the scale with its token', () => {
    // A value on the scale is written `space.md` / `radius.card`, so changing
    // the scale changes the app. Off-scale values (3, 5, 10, 14...) are the
    // designer's call and stay literal until a pass decides them.
    const spaceValues = new Set<number>(Object.values(space));
    const radiusValues = new Set<number>(Object.values(radius));
    const spacing =
      /\b(?:padding|paddingHorizontal|paddingVertical|paddingTop|paddingBottom|paddingLeft|paddingRight|margin|marginHorizontal|marginVertical|marginTop|marginBottom|marginLeft|marginRight|gap|rowGap|columnGap): (\d+)\b(?![.\d])/g;
    const corners = /\bborderRadius: (\d+)\b(?![.\d])/g;
    const stray = new Set<string>();
    for (const path of sources()) {
      if (path.split(sep).includes('theme')) continue;
      const text = readFileSync(path, 'utf8');
      for (const [, value] of text.matchAll(spacing))
        if (spaceValues.has(Number(value))) stray.add(`${path}: spacing ${value}`);
      for (const [, value] of text.matchAll(corners))
        if (radiusValues.has(Number(value))) stray.add(`${path}: radius ${value}`);
    }
    expect([...stray]).toEqual([]);
  });
});
