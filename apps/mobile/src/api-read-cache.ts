type ReadGroup = 'profile' | 'runs' | 'quests' | 'turf' | 'social' | 'inbox' | 'routes';

const readPolicies: ReadonlyArray<{
  paths: RegExp;
  group: ReadGroup;
  seconds: number;
}> = [
  {
    paths: /^\/v1\/(profile|account\/identity|goals\/weekly|progression|achievements)$/,
    group: 'profile',
    seconds: 30
  },
  { paths: /^\/v1\/runs$/, group: 'runs', seconds: 20 },
  { paths: /^\/v1\/activities$/, group: 'runs', seconds: 0 },
  { paths: /^\/v1\/quests(?:\/[^/]+)?$/, group: 'quests', seconds: 30 },
  {
    paths:
      /^\/v1\/territory\/(?:claims(?:\/(?:summary|activity|clusters|recommendations))?|leaderboard(?:\/(?:seasons|hall-of-fame|recap))?|events|season|seasons\/[^/]+\/(?:map|ladder))$/,
    group: 'turf',
    seconds: 20
  },
  {
    paths:
      /^\/v1\/(?:friends(?:\/(?:standings|requests))?|boards\/global|blocks|challenges|competitions(?:\/[^/]+\/standings)?)$/,
    group: 'social',
    seconds: 15
  },
  { paths: /^\/v1\/notifications(?:\/preferences)?$/, group: 'inbox', seconds: 0 },
  { paths: /^\/v1\/routes\/suggest$/, group: 'routes', seconds: 60 }
];

type Entry = { group: ReadGroup; pending: Promise<unknown>; expiresAt: number };

/** Successful, short-lived reads. Full query strings and auth sessions are separate keys. */
export class ApiReadCache {
  private readonly entries = new Map<string, Entry>();

  read<T>(path: string, session: string | undefined, fetchValue: () => Promise<T>): Promise<T> {
    const [pathname = path] = path.split('?', 1);
    const policy = readPolicies.find(({ paths }) => paths.test(pathname));
    if (!policy) return fetchValue();
    const key = JSON.stringify([session, path]);
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      return existing.pending as Promise<T>;
    }

    const pending = fetchValue().then(
      (result) => {
        if (this.entries.get(key) === entry) {
          if (policy.seconds === 0) this.entries.delete(key);
          else entry.expiresAt = Date.now() + policy.seconds * 1000;
        }
        return result;
      },
      (error: unknown) => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        throw error;
      }
    );
    const entry = { group: policy.group, pending, expiresAt: Infinity };
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size > 64) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    return pending;
  }

  afterWrite(path: string) {
    if (path === '/v1/account') {
      this.clear();
      return;
    }
    const groups = new Set<ReadGroup>();
    if (
      /^\/v1\/(profile|account\/identity|goals|progression|achievements|privacy-settings|account\/visibility)(\/|$)/.test(
        path
      )
    )
      groups.add('profile');
    if (/^\/v1\/(friends|invites|boards|blocks|challenges|competitions|clubs)(\/|$)/.test(path))
      groups.add('social');
    if (/^\/v1\/notifications\/(read|preferences)$/.test(path)) groups.add('inbox');
    if (/^\/v1\/quests\//.test(path)) groups.add('quests');
    if (/^\/v1\/(territory|blocks)(\/|$)/.test(path)) groups.add('turf');
    if (/^\/v1\/(activities\/[^/]+(?:\/finalize)?$|territory\/claims$)/.test(path)) {
      for (const group of ['runs', 'profile', 'quests', 'turf', 'social'] as const)
        groups.add(group);
    }
    for (const [key, entry] of this.entries) {
      if (groups.has(entry.group)) this.entries.delete(key);
    }
  }

  clear() {
    this.entries.clear();
  }
}
