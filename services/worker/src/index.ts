import { createLogger } from '@runsphere/observability';

const logger = createLogger('worker');
logger.info('worker.started', { message: 'RunSphere background worker shell is ready.' });
