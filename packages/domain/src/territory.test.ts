import { describe, expect, it } from 'vitest';
import {
  DIVISION_SIZE_TARGET,
  TERRITORY_CAPTURE_ENABLED,
  TERRITORY_CAPTURE_NOTE,
  divisionSizeAdvice,
  parseTerritoryRule,
  territoryDivisionFor,
  territoryEnrollmentOpen
} from './territory.js';

const definition = {
  divisions: [
    { key: 'newcomer', maxPriorActiveWeeks: 3 },
    { key: 'returning', maxPriorActiveWeeks: 25 },
    { key: 'established' }
  ]
};

describe('territory capture', () => {
  it('is off, and says so in one place the whole product reads', () => {
    // The API, the console, and the app all read this rather than each
    // carrying its own claim about a feature none of them implement.
    expect(TERRITORY_CAPTURE_ENABLED).toBe(false);
    expect(TERRITORY_CAPTURE_NOTE).toContain('no cell is claimed');
    expect(TERRITORY_CAPTURE_NOTE).toContain('no location is read');
    expect(TERRITORY_CAPTURE_NOTE).toContain('no rank is calculated');
  });
});

describe('the published division bands', () => {
  it('reads the bands in the order they are published', () => {
    expect(parseTerritoryRule(definition).divisions).toEqual(definition.divisions);
  });

  it('refuses a rule with no open-ended band, which would leave people unplaceable', () => {
    expect(() =>
      parseTerritoryRule({ divisions: [{ key: 'newcomer', maxPriorActiveWeeks: 3 }] })
    ).toThrow(/last division must omit/);
  });

  it('refuses bands that do not ascend', () => {
    expect(() =>
      parseTerritoryRule({
        divisions: [
          { key: 'returning', maxPriorActiveWeeks: 25 },
          { key: 'newcomer', maxPriorActiveWeeks: 3 },
          { key: 'established' }
        ]
      })
    ).toThrow(/ascending/);
  });

  it('refuses an empty or malformed rule rather than placing somebody by default', () => {
    expect(() => parseTerritoryRule({ divisions: [] })).toThrow(/non-empty/);
    expect(() => parseTerritoryRule(null)).toThrow(/JSON object/);
  });
});

describe('which division somebody enrols into', () => {
  const rule = parseTerritoryRule(definition);

  it('reads the band as an inclusive ceiling, from weeks alone', () => {
    expect(territoryDivisionFor(0, rule)).toBe('newcomer');
    expect(territoryDivisionFor(3, rule)).toBe('newcomer');
    expect(territoryDivisionFor(4, rule)).toBe('returning');
    expect(territoryDivisionFor(25, rule)).toBe('returning');
    expect(territoryDivisionFor(26, rule)).toBe('established');
  });

  it('gives a first-time participant the newcomer band', () => {
    // `product.md`: new participants enter a newcomer division.
    expect(territoryDivisionFor(0, rule)).toBe('newcomer');
  });
});

describe('when a season can be joined', () => {
  it('accepts enrolment while open and while running', () => {
    expect(territoryEnrollmentOpen('open')).toBe(true);
    // Hearing about a season on Tuesday should not exclude somebody from it.
    expect(territoryEnrollmentOpen('live')).toBe(true);
  });

  it('refuses a season that has only been announced, or has ended', () => {
    expect(territoryEnrollmentOpen('announced')).toBe(false);
    expect(territoryEnrollmentOpen('ended')).toBe(false);
  });
});

describe('division size advice', () => {
  it('reports the targets from product.md without acting on them', () => {
    expect(DIVISION_SIZE_TARGET).toEqual({
      minimum: 100,
      maximum: 250,
      mergeBelow: 40,
      splitAbove: 300
    });
  });

  it('advises merging a division too small to be a cohort', () => {
    expect(divisionSizeAdvice(39)).toBe('merge');
    expect(divisionSizeAdvice(40)).toBe('healthy');
  });

  it('advises splitting one that has outgrown the target', () => {
    expect(divisionSizeAdvice(300)).toBe('healthy');
    expect(divisionSizeAdvice(301)).toBe('split');
  });

  it('calls the whole target range healthy, because the range is the goal', () => {
    expect(divisionSizeAdvice(100)).toBe('healthy');
    expect(divisionSizeAdvice(250)).toBe('healthy');
  });
});
