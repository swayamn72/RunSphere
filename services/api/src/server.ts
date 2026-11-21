import { apiConfig } from '@runsphere/config';
import { createDatabase, defaultDatabaseUrl, prepareSchema } from '@runsphere/db';
import { buildApp } from './app.js';

const db = createDatabase(defaultDatabaseUrl(process.env));
await prepareSchema(db, process.env);
const app = buildApp({ config: apiConfig, db });
await app.listen({ host: apiConfig.host, port: apiConfig.port });
