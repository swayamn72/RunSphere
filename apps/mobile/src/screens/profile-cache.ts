import { ApiFailure, type MobileApiClient } from '../api-client';

const freshForMs = 60_000;

export function profileResource<T>(fetchValue: (previous: T | undefined) => Promise<T>) {
  let value: T | undefined;
  let expiresAt = 0;
  let pending: Promise<T> | undefined;

  return {
    peek: () => value,
    load(): Promise<T> {
      if (pending) return pending;
      if (value !== undefined && Date.now() < expiresAt) return Promise.resolve(value);
      const request = Promise.resolve()
        .then(() => fetchValue(value))
        .then((result) => {
          if (pending === request) {
            value = result;
            expiresAt = Date.now() + freshForMs;
          }
          return value === undefined ? result : value;
        })
        .finally(() => {
          if (pending === request) pending = undefined;
        });
      pending = request;
      return request;
    },
    write(next: T) {
      pending = undefined;
      value = next;
      expiresAt = Date.now() + freshForMs;
    },
    invalidate() {
      pending = undefined;
      expiresAt = 0;
    }
  };
}

export function createProfileCache(api: MobileApiClient) {
  return {
    identity: profileResource(() => api.getIdentity()),
    profile: profileResource(async () => {
      try {
        return await api.getProfile();
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 404) return null;
        throw error;
      }
    }),
    progression: profileResource(() => api.getProgressionSummary()),
    turf: profileResource(() => api.getTerritoryClaimSummary()),
    runs: profileResource(() => api.getRunLog())
  };
}

export type ProfileCache = ReturnType<typeof createProfileCache>;
