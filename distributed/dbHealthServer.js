/**
 * distributed/dbHealthServer.js
 * -----------------------------------------------------------------------------
 * DB-node health sidecar.
 *
 * MongoDB (mongod) does not expose an HTTP endpoint, so the failure detector
 * cannot probe it directly. This tiny process runs ON the database node next to
 * mongod, holds a connection to it, and exposes /health, /health/ready over
 * HTTP. Now the database node is a first-class, network-observable node in the
 * cluster: if mongod dies, the sidecar's readiness flips to not-ready and its
 * dependency block reports the failure; if the whole DB node dies, the sidecar
 * stops answering and the detector marks the node DOWN by timeout.
 *
 * Design for fault tolerance:
 *   - The HTTP health server starts FIRST and unconditionally, so /health is
 *     available (liveness = 200) even while the database is unreachable.
 *   - The database connection is attempted in the BACKGROUND with retry, so the
 *     sidecar recovers automatically when mongod comes back (important for the
 *     demo: kill mongod, watch not-ready, restart mongod, watch it go ready).
 *
 * Run it on the DB node:
 *   NODE_ROLE=db DB_HEALTH_PORT=6000 MONGODB_URI=mongodb://localhost:27017/enrollment \
 *     node distributed/dbHealthServer.js
 */

import express from 'express';
import { database, dbHealthPort } from './config.js';
import DatabaseService from './DatabaseService.js';
import { createHealthRouter } from './healthRouter.js';

const RECONNECT_INTERVAL_MS = 3000;

function main() {
  const db = new DatabaseService({
    uri: database.uri,
    serverSelectionTimeoutMs: database.serverSelectionTimeoutMs,
    pingIntervalMs: database.pingIntervalMs,
  });

  // Never let a background connection error crash the sidecar (see the note in
  // DatabaseService about Node's 'error' event). Just log it.
  db.on('db-error', (err) => {
    console.error(`[db-health] db error: ${err.message || err}`);
  });

  // 1) Start the health server immediately so liveness is always answerable.
  const app = express();
  app.use(
    createHealthRouter({
      role: 'db',
      dependencies: {
        // The DB node's critical dependency is mongod itself, checked by ping.
        mongo: async () => {
          const status = db.getStatus();
          const ping = await db.ping();
          return { ok: ping.ok, state: status.state, latencyMs: ping.latencyMs, error: ping.error };
        },
      },
    }),
  );
  app.listen(dbHealthPort, () => {
    console.log(`[db-health] sidecar listening on :${dbHealthPort} (GET /health, /health/ready)`);
  });

  // 2) Connect in the background, retrying until mongod is reachable.
  let connected = false;
  const tryConnect = async () => {
    if (connected) return;
    try {
      await db.connect();
      connected = true;
      console.log(`[db-health] connected to ${database.uri}`);
    } catch (err) {
      console.error(`[db-health] connect failed (${err.message}); retrying in ${RECONNECT_INTERVAL_MS}ms`);
    }
  };
  db.on('disconnected', () => {
    connected = false;
  });
  tryConnect();
  const timer = setInterval(tryConnect, RECONNECT_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

main();
