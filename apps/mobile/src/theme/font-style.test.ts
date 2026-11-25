import { describe, expect, it } from 'vitest';
import { flattenStyle, withInter } from './font-style';

describe('Inter by weight', () => {
  it('leaves a style untouched until Inter has loaded', () => {
    const style = { fontWeight: '700', fontSize: 15 };
    expect(withInter(style, false)).toBe(style);
  });

  it('picks the file that carries the weight and drops the weight itself', () => {
    expect(withInter({ fontWeight: '700', fontSize: 15 }, true)).toEqual({
      fontSize: 15,
      fontFamily: 'Inter_700Bold'
    });
    expect(withInter({ fontWeight: '600' }, true)).toEqual({ fontFamily: 'Inter_600SemiBold' });
    expect(withInter({ fontWeight: '500' }, true)).toEqual({ fontFamily: 'Inter_500Medium' });
    expect(withInter({}, true)).toEqual({ fontFamily: 'Inter_400Regular' });
    expect(withInter({ fontWeight: 'bold' }, true)).toEqual({ fontFamily: 'Inter_700Bold' });
  });

  it('flattens style arrays the way React Native does, later entries winning', () => {
    const style = [{ fontWeight: '400', fontSize: 12 }, [{ fontWeight: '700' }], false, undefined];
    expect(flattenStyle(style)).toEqual({ fontWeight: '700', fontSize: 12 });
    expect(withInter(style, true)).toEqual({ fontSize: 12, fontFamily: 'Inter_700Bold' });
  });

  it('keeps a family a style already chose', () => {
    const style = { fontFamily: 'Courier', fontWeight: '700' };
    expect(withInter(style, true)).toBe(style);
  });
});
