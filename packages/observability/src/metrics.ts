export interface MetricsSnapshot {
  startedAt: number;
  requests: number;
  responsesByStatus: ReadonlyMap<number, number>;
}

export interface Metrics {
  recordResponse(statusCode: number): void;
  snapshot(): MetricsSnapshot;
  renderPrometheus(service: string): string;
}

export const createMetrics = (now: () => number = Date.now): Metrics => {
  const startedAt = now();
  let requests = 0;
  const responsesByStatus = new Map<number, number>();

  return {
    recordResponse(statusCode) {
      requests += 1;
      responsesByStatus.set(statusCode, (responsesByStatus.get(statusCode) ?? 0) + 1);
    },
    snapshot() {
      return { startedAt, requests, responsesByStatus: new Map(responsesByStatus) };
    },
    renderPrometheus(service) {
      const uptimeSeconds = Math.max(0, (now() - startedAt) / 1000);
      const lines = [
        '# HELP runsphere_process_uptime_seconds Process uptime in seconds.',
        '# TYPE runsphere_process_uptime_seconds gauge',
        `runsphere_process_uptime_seconds{service="${service}"} ${uptimeSeconds.toFixed(3)}`,
        '# HELP runsphere_http_requests_total HTTP responses by status code.',
        '# TYPE runsphere_http_requests_total counter'
      ];
      for (const [statusCode, count] of [...responsesByStatus.entries()].sort(
        ([left], [right]) => left - right
      )) {
        lines.push(
          `runsphere_http_requests_total{service="${service}",status_code="${statusCode}"} ${count}`
        );
      }
      return `${lines.join('\n')}\n`;
    }
  };
};
