export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const REDACTED = '[REDACTED]';
const CIRCULAR = '[Circular]';
const UNSERIALIZABLE = '[Unserializable]';

const sensitiveFieldName = /(?:email|password|token|coordinates?|polyline|place[_-]?ids?)/i;

const redactValue = (value: unknown, ancestors = new WeakSet<object>()): unknown => {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (ancestors.has(value)) {
    return CIRCULAR;
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, ancestors));
    }

    const redacted: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (sensitiveFieldName.test(key)) {
        redacted[key] = REDACTED;
        continue;
      }

      try {
        redacted[key] = redactValue((value as Record<string, unknown>)[key], ancestors);
      } catch {
        redacted[key] = UNSERIALIZABLE;
      }
    }
    return redacted;
  } finally {
    ancestors.delete(value);
  }
};

const log = (
  level: 'info' | 'error',
  service: string,
  event: string,
  fields?: Record<string, unknown>
) => {
  const entry = JSON.stringify({
    level,
    service,
    event,
    data: redactValue(fields ?? {})
  });

  if (level === 'info') {
    console.info(entry);
  } else {
    console.error(entry);
  }
};

export const createLogger = (service: string): Logger => ({
  info(event, fields) {
    log('info', service, event, fields);
  },
  error(event, fields) {
    log('error', service, event, fields);
  }
});
