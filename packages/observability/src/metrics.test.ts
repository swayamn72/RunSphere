import { describe, expect, it } from 'vitest';
import { createMetrics } from './metrics.js';

describe('createMetrics', () => {
  it('renders only service and status labels', () => {
    const metrics = createMetrics(() => 1_000);
    metrics.recordResponse(200);
    metrics.recordResponse(503);

    expect(metrics.renderPrometheus('api')).toContain(
      'runsphere_http_requests_total{service="api",status_code="503"} 1'
    );
    expect(metrics.renderPrometheus('api')).not.toContain('account');
  });
});
