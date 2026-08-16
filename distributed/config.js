/**
 * distributed/config.js
 * -----------------------------------------------------------------------------
 * Central configuration for the distributed fault-tolerance subsystem
 *
 * Everything here is driven by environment variables so the exact same code can
 * run on separate machines / VMs / containers (the "nodes") without edits. Sane
 * localhost defaults are provided so a single developer can run the whole
 * cluster on one machine for testing and demos.
 *
 * Node roles in this system (see Specifications.pdf):
 *   - view  : the MVC "View" node (renders Handlebars pages, proxies to app).
 *   - app   : the API / controllers node (business logic; talks to the DB).
 *   - db    : the Database node (MongoDB + a small HTTP health sidecar so the
 *             DB node is reachable by the failure detector, since mongod itself
 *             does not speak HTTP).
 *   - monitor : an optional observer node that actively probes every other node
 *               and reports the health of the whole cluster.
 */

/** Parse an integer env var with a fallback. */
function intEnv(name, fallback) {
  const raw = process.env[name];
  const n = raw === undefined ? NaN : parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse a string env var with a fallback. */
function strEnv(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

/**
 * Failure-detector timing.
 *
 * A node is expected to be seen (via heartbeat or successful health probe)
 * every HEARTBEAT_INTERVAL_MS. If it has not been seen for longer than the
 * SUSPECT / DOWN thresholds it is marked SUSPECT and then DOWN. Thresholds are
 * expressed as a multiple of the interval so they scale together.
 *
 * These are deliberately generous by default to avoid false positives from
 * transient network jitter; tune them lower for a snappier demo.
 */
export const timing = {
  heartbeatIntervalMs: intEnv('HEARTBEAT_INTERVAL_MS', 2000),
  // Missed intervals before a node is SUSPECT / DOWN.
  suspectAfterMisses: intEnv('SUSPECT_AFTER_MISSES', 2),
  downAfterMisses: intEnv('DOWN_AFTER_MISSES', 4),
  // How long an individual health probe may take before it is treated as a miss.
  probeTimeoutMs: intEnv('PROBE_TIMEOUT_MS', 1500),
};

/** Convenience: absolute timeouts (ms) derived from the interval + misses. */
export const derivedTimeouts = {
  suspectTimeoutMs: timing.heartbeatIntervalMs * timing.suspectAfterMisses,
  downTimeoutMs: timing.heartbeatIntervalMs * timing.downAfterMisses,
};

/**
 * The set of nodes this process should know about. Each node has an id, a role,
 * and a health URL the failure detector can probe.
 *
 * On a real deployment you would set VIEW_URL / APP_URL / DB_HEALTH_URL to the
 * other VMs' addresses. On one machine the localhost defaults just work.
 */
export const nodes = [
  {
    id: 'view',
    role: 'view',
    healthUrl: strEnv('VIEW_URL', 'http://localhost:4000') + '/health',
    critical: false,
  },
  {
    id: 'app',
    role: 'app',
    healthUrl: strEnv('APP_URL', 'http://localhost:5000') + '/health',
    critical: false,
  },
  {
    id: 'db',
    role: 'db',
    healthUrl: strEnv('DB_HEALTH_URL', 'http://localhost:6000') + '/health',
    critical: true,
  },
];

/**
 * Database configuration for the DB node / database service.
 *
 * MONGODB_URI may be a single host (mongodb://host:27017/db) or, for the
 * *bonus* redundant persistence layer, a replica-set connection string listing
 * multiple hosts:
 *   mongodb://m1:27017,m2:27017,m3:27017/enrollment?replicaSet=rs0
 * The database service treats both transparently, so enabling redundancy later
 * is a configuration change, not a code change.
 */
export const database = {
  uri: strEnv('MONGODB_URI', 'mongodb://localhost:27017/enrollment'),
  // Fail fast instead of hanging when the DB node is unreachable. This is what
  // lets DB-dependent features "stop working" cleanly while the rest of the app
  // keeps serving requests.
  serverSelectionTimeoutMs: intEnv('DB_SELECTION_TIMEOUT_MS', 1500),
  // How often the database service re-checks liveness with an admin ping.
  pingIntervalMs: intEnv('DB_PING_INTERVAL_MS', 2000),
};

/** This process's own role, used by the health router to label responses. */
export const selfRole = strEnv('NODE_ROLE', 'app');

/** Port the DB health sidecar listens on (db node). */
export const dbHealthPort = intEnv('DB_HEALTH_PORT', 6000);

/** Port the cluster monitor's dashboard listens on. */
export const monitorPort = intEnv('MONITOR_PORT', 7000);

export default {
  timing,
  derivedTimeouts,
  nodes,
  database,
  selfRole,
  dbHealthPort,
  monitorPort,
};
