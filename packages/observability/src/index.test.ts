import { describe, expect, it, vi } from 'vitest';
import { createLogger } from './index.js';

describe('createLogger', () => {
  it('emits caller fields beneath the reserved structured event fields', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    createLogger('worker').info('worker.started', {
      jobCount: 0,
      level: 'forged-level',
      service: 'forged-service',
      event: 'forged-event'
    });

    expect(JSON.parse(info.mock.calls[0]![0] as string)).toEqual({
      level: 'info',
      service: 'worker',
      event: 'worker.started',
      data: {
        jobCount: 0,
        level: 'forged-level',
        service: 'forged-service',
        event: 'forged-event'
      }
    });
    info.mockRestore();
  });

  it('recursively redacts sensitive activity and credential fields', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    createLogger('worker').error('activity.failed', {
      account: { email: 'runner@example.test', profile: { placeId: 'place-123' } },
      request: {
        password: 'not-logged',
        accessToken: 'not-logged',
        route: { coordinates: [19.076, 72.877], encodedPolyline: 'not-logged' }
      },
      activities: [{ startPlaceIds: ['place-456'] }]
    });

    expect(JSON.parse(error.mock.calls[0]![0] as string)).toEqual({
      level: 'error',
      service: 'worker',
      event: 'activity.failed',
      data: {
        account: { email: '[REDACTED]', profile: { placeId: '[REDACTED]' } },
        request: {
          password: '[REDACTED]',
          accessToken: '[REDACTED]',
          route: { coordinates: '[REDACTED]', encodedPolyline: '[REDACTED]' }
        },
        activities: [{ startPlaceIds: '[REDACTED]' }]
      }
    });
    error.mockRestore();
  });

  it('serializes circular references and BigInt values safely', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(() =>
      createLogger('worker').info('worker.finished', { circular, durationNs: 42n })
    ).not.toThrow();
    expect(JSON.parse(info.mock.calls[0]![0] as string)).toEqual({
      level: 'info',
      service: 'worker',
      event: 'worker.finished',
      data: { circular: { self: '[Circular]' }, durationNs: '42' }
    });
    info.mockRestore();
  });
});
