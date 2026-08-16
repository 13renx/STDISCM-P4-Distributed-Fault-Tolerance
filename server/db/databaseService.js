/**
 * server/db/databaseService.js
 * -----------------------------------------------------------------------------
 * A single shared DatabaseService instance for the application node.
 *
 * Import this anywhere you need to know whether the database node is reachable
 * (health endpoints, the dbGuard middleware, controllers that want to branch on
 * availability):
 *
 *     import databaseService from './server/db/databaseService.js';
 *     const { ok } = databaseService.getStatus();
 *
 * The connection itself is established by connectDB() (see server/DbConnect.js),
 * which delegates to this instance so there is exactly one connection and one
 * source of truth for DB health across the whole app node.
 */

import DatabaseService from '../../distributed/DatabaseService.js';
import { database } from '../../distributed/config.js';

const databaseService = new DatabaseService({
  uri: database.uri,
  serverSelectionTimeoutMs: database.serverSelectionTimeoutMs,
  pingIntervalMs: database.pingIntervalMs,
});

export default databaseService;
