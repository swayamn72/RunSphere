import { describe, expect, it } from 'vitest';
import { areaFromSearch, searchForArea } from './area-url.js';

describe('area in the address bar', () => {
  it('opens the area a link names, when the roles allow it', () => {
    expect(areaFromSearch('?area=moderation', ['moderator'])).toBe('moderation');
    expect(areaFromSearch('?area=review', [])).toBe('review');
  });

  it('ignores an area the account may not open, and anything unknown', () => {
    expect(areaFromSearch('?area=campaigns', ['moderator'])).toBeUndefined();
    expect(areaFromSearch('?area=nonsense', ['admin'])).toBeUndefined();
    expect(areaFromSearch('', ['admin'])).toBeUndefined();
  });

  it('writes the area and keeps other parameters', () => {
    expect(searchForArea('', 'quests')).toBe('?area=quests');
    expect(searchForArea('?x=1&area=turf', 'quests')).toBe('?x=1&area=quests');
  });
});
