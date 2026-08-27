import { createLogger, type Logger } from '@runsphere/observability';

export interface WorkerStartupResult {
  service: 'worker';
  status: 'ready';
  queuedJobs: number;
}

export const startWorker = (logger: Logger = createLogger('worker')): WorkerStartupResult => {
  const result: WorkerStartupResult = { service: 'worker', status: 'ready', queuedJobs: 0 };
  logger.info('worker.started', { ...result });
  return result;
};
