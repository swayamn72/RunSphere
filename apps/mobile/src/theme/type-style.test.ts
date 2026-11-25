import { describe, expect, it } from 'vitest';
import { typeScale, type TypeRoleName } from '@runsphere/ui';
import { interFamilyByWeight, textStyleFor } from './type-style';

describe('text styles from the type scale', () => {
  it('carries the weight in the Inter family once it is loaded', () => {
    const style = textStyleFor('title', { fontsReady: true });
    expect(style.fontFamily).toBe('Inter_700Bold');
    // Android would synthesise bold on top of a bold file.
    expect(style.fontWeight).toBeUndefined();
    expect(style.fontSize).toBe(28);
    expect(style.lineHeight).toBe(34);
  });

  it('falls back to the platform font with a numeric weight when Inter is not loaded', () => {
    const style = textStyleFor('bodyStrong', { fontsReady: false });
    expect(style.fontFamily).toBeUndefined();
    expect(style.fontWeight).toBe('600');
  });

  it('uses equal-width digits for number roles, and on request', () => {
    for (const role of ['liveMetric', 'display', 'metric'] as const)
      expect(textStyleFor(role, { fontsReady: true }).fontVariant).toEqual(['tabular-nums']);
    expect(textStyleFor('body', { fontsReady: true }).fontVariant).toBeUndefined();
    expect(textStyleFor('body', { fontsReady: true, tabular: true }).fontVariant).toEqual([
      'tabular-nums'
    ]);
    expect(
      textStyleFor('metric', { fontsReady: true, tabular: false }).fontVariant
    ).toBeUndefined();
  });

  it('uppercases only the overline', () => {
    for (const role of Object.keys(typeScale) as TypeRoleName[])
      expect(textStyleFor(role).textTransform === 'uppercase').toBe(role === 'overline');
  });

  it('has a registered Inter file for every weight, and only the four', () => {
    expect(Object.keys(interFamilyByWeight).sort()).toEqual(
      ['bold', 'medium', 'regular', 'semibold'].sort()
    );
  });
});
