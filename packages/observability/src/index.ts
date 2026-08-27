export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export const createLogger = (service: string): Logger => ({
  info(event, fields) {
    console.info(JSON.stringify({ level: 'info', service, event, ...fields }));
  },
  error(event, fields) {
    console.error(JSON.stringify({ level: 'error', service, event, ...fields }));
  }
});
