import { describe, expect, it } from 'vitest';
import {
  CLAIM_TRADING_REVIEW_NOTE,
  DEFAULT_CLAIM_TRADING_RULE,
  detectClaimTrading,
  pairKey,
  type TakeoverEvent
} from './claim-trading.js';

const A = 'account-a';
const B = 'account-b';
const C = 'account-c';
const NOW = new Date('2026-09-20T00:00:00.000Z');

/** `count` alternating takeovers between two accounts, one per day. */
const pingPong = (
  count: number,
  lineageId = 'ground-1',
  from = A,
  to = B,
  startDaysAgo = 20
): TakeoverEvent[] =>
  Array.from({ length: count }, (_unused, index) => ({
    lineageId,
    fromAccountId: index % 2 === 0 ? from : to,
    toAccountId: index % 2 === 0 ? to : from,
    at: new Date(NOW.getTime() - (startDaysAgo - index) * 86_400_000)
  }));

describe('identifying a pair', () => {
  it('keys the same two accounts the same way whichever order they arrive in', () => {
    expect(pairKey(A, B)).toBe(pairKey(B, A));
  });
});

describe('ground being passed back and forth', () => {
  it('says nothing about a single swap', () => {
    // One person taking ground off another is the entire point of the game.
    expect(detectClaimTrading(pingPong(1), NOW)).toEqual([]);
  });

  it('says nothing about an ordinary rivalry', () => {
    // Two or three exchanges over three weeks is two people who both like the
    // same loop.
    expect(detectClaimTrading(pingPong(4), NOW)).toEqual([]);
  });

  it('raises a question once the ground is only ever going back and forth', () => {
    const findings = detectClaimTrading(pingPong(10), NOW);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.accounts).toEqual([A, B].sort());
    expect(findings[0]?.exchanges).toBeGreaterThanOrEqual(DEFAULT_CLAIM_TRADING_RULE.minExchanges);
    expect(findings[0]?.pairShare).toBe(1);
  });

  it('counts there-and-back exchanges, not merely takeovers', () => {
    // Ten alternating takeovers is nine completed exchanges, not ten.
    expect(detectClaimTrading(pingPong(10), NOW)[0]?.exchanges).toBe(9);
  });

  it('ignores anything outside the window', () => {
    const old = pingPong(10, 'ground-1', A, B, 400);

    expect(detectClaimTrading(old, NOW)).toEqual([]);
  });

  it('leaves ground that several people have fought over alone', () => {
    // A third runner in the mix means this is a contest, whatever two of them
    // did between themselves.
    const contested: TakeoverEvent[] = [
      ...pingPong(10),
      ...Array.from({ length: 6 }, (_unused, index) => ({
        lineageId: 'ground-1',
        fromAccountId: index % 2 === 0 ? B : C,
        toAccountId: index % 2 === 0 ? C : B,
        at: new Date(NOW.getTime() - (5 - index) * 86_400_000)
      }))
    ];

    expect(detectClaimTrading(contested, NOW)).toEqual([]);
  });

  it('reads each piece of ground separately', () => {
    // Two people taking different territories off each other are competing
    // across a city, which is the game working.
    const spread = [
      ...pingPong(3, 'ground-1'),
      ...pingPong(3, 'ground-2'),
      ...pingPong(3, 'ground-3')
    ];

    expect(detectClaimTrading(spread, NOW)).toEqual([]);
  });

  it('flags every piece of ground a pair is cycling', () => {
    const both = [...pingPong(10, 'ground-1'), ...pingPong(10, 'ground-2')];
    const findings = detectClaimTrading(both, NOW);

    expect(findings.map((finding) => finding.lineageId).sort()).toEqual(['ground-1', 'ground-2']);
  });

  it('ignores a takeover from somebody to themselves', () => {
    const selfish: TakeoverEvent[] = Array.from({ length: 10 }, (_unused, index) => ({
      lineageId: 'ground-1',
      fromAccountId: A,
      toAccountId: A,
      at: new Date(NOW.getTime() - index * 86_400_000)
    }));

    expect(detectClaimTrading(selfish, NOW)).toEqual([]);
  });

  it('reports the numbers a reviewer needs to disagree with it', () => {
    const [finding] = detectClaimTrading(pingPong(10), NOW);

    expect(finding?.firstAt).toBeInstanceOf(Date);
    expect(finding?.lastAt).toBeInstanceOf(Date);
    expect(finding!.lastAt.getTime()).toBeGreaterThan(finding!.firstAt.getTime());
  });

  it('puts the most cycled ground first', () => {
    const findings = detectClaimTrading(
      [...pingPong(6, 'quiet'), ...pingPong(14, 'busy', A, B, 20)],
      NOW
    );

    expect(findings[0]?.lineageId).toBe('busy');
  });
});

describe('what the system does with a finding', () => {
  it('asks a question rather than making an accusation', () => {
    // The same pattern is produced by two friends racing every week, and
    // nothing in the data separates them from collusion.
    expect(CLAIM_TRADING_REVIEW_NOTE).toContain('race each other every week');
    expect(CLAIM_TRADING_REVIEW_NOTE).toContain('Nothing here decides');
    expect(CLAIM_TRADING_REVIEW_NOTE).not.toMatch(/ban|suspend|cheat|fraud/i);
  });
});
