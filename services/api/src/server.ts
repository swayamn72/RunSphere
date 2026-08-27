import { apiConfig } from '@runsphere/config';
import { buildApp } from './app.js';

const app = buildApp({ config: apiConfig });
await app.listen({ host: apiConfig.host, port: apiConfig.port });
