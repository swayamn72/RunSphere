import { describe, expect, it } from 'vitest';
import { divisionFor, parseGlobalBoardRule, rankedOnGlobalBoard } from './global-board.js';

const definition = {
  dailyCapMinutes: 240,
  pageSize: 50,
  minScore: 1,
  divisions: [
    { key: 'newcomer', maxPriorActiveWeeks: 0 },
    { key: 'rising', maxPriorActiveWeeks: 3 },
    { key: 'established' }
  ]
};

describe('the published global board rule', () => {
  it('reads the bands in the order they are published', () => {
    expect(parseGlobalBoardRule(definition)).toEqual({
      dailyCapMinutes: 240,
      pageSize: 50,
      minScore: 1,
      divisions: [
        { key: 'newcomer', maxPriorActiveWeeks: 0 },
        { key: 'rising', maxPriorActiveWeeks: 3 },
        { key: 'established' }
      ]
    });
  });

  it('refuses a rule with no open-ended band, which would leave accounts unrankable', () => {
    expect(() =>
      parseGlobalBoardRule({
        ...definition,
        divisions: [
          { key: 'newcomer', maxPriorActiveWeeks: 0 },
          { key: 'rising', maxPriorActiveWeeks: 3 }
        ]
      })
    ).toThrow(/last division must omit/);
  });

  it('refuses an unreachable band after the open-ended one', () => {
    expect(() =>
      parseGlobalBoardRule({
        ...definition,
        divisions: [{ key: 'everyone' }, { key: 'newcomer', maxPriorActiveWeeks: 0 }]
      })
    ).toThrow(/only if it is last/);
  });

  it('refuses bands that do not ascend, because the first match must be the narrowest', () => {
    expect(() =>
      parseGlobalBoardRule({
        ...definition,
        divisions: [
          { key: 'rising', maxPriorActiveWeeks: 3 },
          { key: 'newcomer', maxPriorActiveWeeks: 0 },
          { key: 'established' }
        ]
      })
    ).toThrow(/ascending/);
  });

  it('refuses missing or out-of-range numbers rather than guessing them', () => {
    expect(() => parseGlobalBoardRule({ ...definition, pageSize: 0 })).toThrow(/pageSize/);
    expect(() => parseGlobalBoardRule({ ...definition, minScore: 0 })).toThrow(/minScore/);
    expect(() => parseGlobalBoardRule({ ...definition, dailyCapMinutes: 1441 })).toThrow(
      /dailyCapMinutes/
    );
    expect(() => parseGlobalBoardRule({ ...definition, divisions: [] })).toThrow(/divisions/);
    expect(() => parseGlobalBoardRule(null)).toThrow(/JSON object/);
  });
});

describe('division assignment', () => {
  const rule = parseGlobalBoardRule(definition);

  it('puts a first week in the newcomer band', () => {
    expect(divisionFor(0, rule)).toBe('newcomer');
  });

  it('reads the bands as inclusive ceilings', () => {
    expect(divisionFor(1, rule)).toBe('rising');
    expect(divisionFor(3, rule)).toBe('rising');
    expect(divisionFor(4, rule)).toBe('established');
    expect(divisionFor(400, rule)).toBe('established');
  });

  it('never assigns a band from anything but a count of weeks', () => {
    // A negative or fractional history is a data error, not a lower band.
    expect(divisionFor(-5, rule)).toBe('newcomer');
    expect(divisionFor(3.9, rule)).toBe('rising');
  });
});

describe('qualifying for the board', () => {
  const rule = parseGlobalBoardRule(definition);

  it('keeps an account that did not move off the board entirely', () => {
    expect(rankedOnGlobalBoard(0, rule)).toBe(false);
    expect(rankedOnGlobalBoard(1, rule)).toBe(true);
  });
});
