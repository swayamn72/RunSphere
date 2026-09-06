/**
 * Claim-trading detection (Phase 5, milestone 5.6).
 *
 * `run-integrity.ts` asks whether one run could have happened. This asks a
 * different question: whether a *pattern* of runs is a contest at all. Two
 * accounts can take the same ground off each other over and over, each run
 * perfectly legitimate on its own, and manufacture capture counts, defence
 * counts, and leaderboard positions between them.
 *
 * **The hard part is that collusion and rivalry look identical from here.** Two
 * friends who genuinely race each other round the same park every week produce
 * exactly the trace this detects. There is no threshold that separates them,
 * because the difference is intent and intent is not in the data.
 *
 * So this never decides. It surfaces a pattern for a human, with the numbers
 * that produced it, and the product's response to a confirmed case is a policy
 * question nobody has answered yet. A detector that suspended accounts on this
 * signal would be punishing people for running together.
 */

/** One takeover, reduced to what a pattern is visible in. */
export interface TakeoverEvent {
  /** The ground. Every claim over the same territory shares this. */
  lineageId: string;
  fromAccountId: string;
  toAccountId: string;
  at: Date;
}

export interface ClaimTradingRule {
  /** How far back a pattern is read. */
  windowDays: number;
  /**
   * Complete there-and-back exchanges before a pattern is worth a look. One
   * swap is a contest; two is a rivalry; this many starts to look like a loop.
   */
  minExchanges: number;
  /**
   * How much of the ground's history the pair must account for. A territory
   * that five people have fought over is a contest whatever two of them did.
   */
  minPairShare: number;
}

export const DEFAULT_CLAIM_TRADING_RULE: ClaimTradingRule = {
  windowDays: 21,
  minExchanges: 4,
  minPairShare: 0.9
};

export interface ClaimTradingFinding {
  lineageId: string;
  /** The two accounts, sorted, so the same pair is always the same key. */
  accounts: readonly [string, string];
  /** Completed A→B→A exchanges inside the window. */
  exchanges: number;
  /** Share of the ground's takeovers these two account for, 0–1. */
  pairShare: number;
  firstAt: Date;
  lastAt: Date;
}

const MILLIS_PER_DAY = 86_400_000;

/** A stable key for an unordered pair. */
export const pairKey = (left: string, right: string): string =>
  left < right ? `${left}:${right}` : `${right}:${left}`;

/**
 * Patterns worth a human looking at.
 *
 * Read per piece of ground rather than per account: two people who take
 * different territories off each other are competing across a city, which is
 * the game working. Two people passing one piece of ground back and forth are
 * doing something else — or are neighbours with a favourite loop, which is why
 * this only ever produces a question.
 */
export const detectClaimTrading = (
  events: readonly TakeoverEvent[],
  now: Date,
  rule: ClaimTradingRule = DEFAULT_CLAIM_TRADING_RULE
): ClaimTradingFinding[] => {
  const cutoff = now.getTime() - rule.windowDays * MILLIS_PER_DAY;
  const byLineage = new Map<string, TakeoverEvent[]>();
  for (const event of events) {
    if (event.at.getTime() < cutoff) continue;
    if (event.fromAccountId === event.toAccountId) continue;
    const list = byLineage.get(event.lineageId) ?? [];
    list.push(event);
    byLineage.set(event.lineageId, list);
  }

  const findings: ClaimTradingFinding[] = [];
  for (const [lineageId, all] of byLineage) {
    const ordered = [...all].sort((left, right) => left.at.getTime() - right.at.getTime());

    // Count exchanges per pair: a completed there-and-back, not merely two
    // takeovers involving the same people.
    const exchanges = new Map<string, number>();
    const lastDirection = new Map<string, string>();
    for (const event of ordered) {
      const key = pairKey(event.fromAccountId, event.toAccountId);
      const previous = lastDirection.get(key);
      // An exchange completes when the ground comes back the other way.
      if (previous && previous !== event.toAccountId) {
        exchanges.set(key, (exchanges.get(key) ?? 0) + 1);
      }
      lastDirection.set(key, event.toAccountId);
    }

    for (const [key, count] of exchanges) {
      if (count < rule.minExchanges) continue;
      const [left, right] = key.split(':') as [string, string];
      const involved = ordered.filter(
        (event) =>
          (event.fromAccountId === left || event.fromAccountId === right) &&
          (event.toAccountId === left || event.toAccountId === right)
      );
      const pairShare = involved.length / ordered.length;
      // Ground several people have fought over is a contest, whatever two of
      // them did between themselves.
      if (pairShare < rule.minPairShare) continue;
      findings.push({
        lineageId,
        accounts: [left, right],
        exchanges: count,
        pairShare,
        firstAt: involved[0]!.at,
        lastAt: involved[involved.length - 1]!.at
      });
    }
  }
  return findings.sort((left, right) => right.exchanges - left.exchanges);
};

/**
 * What a reviewer is told. Phrased as a question because that is what it is:
 * the same pattern is produced by two friends racing each other every week, and
 * nothing in the data separates them.
 */
export const CLAIM_TRADING_REVIEW_NOTE =
  'These two accounts have passed this ground back and forth and account for nearly all of its history. That is what collusion looks like, and it is also what two people who race each other every week look like. Nothing here decides which.';
