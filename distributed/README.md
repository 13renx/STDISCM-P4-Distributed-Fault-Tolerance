# Distributed Fault-Tolerance Subsystem 

This folder contains the **database service**, **failure detection**, and
**failure-scenario testing** for the distributed enrollment system. It is
self-contained and domain-agnostic: it plugs into whatever routes the app node
exposes (courses, enrollment, grades) without depending on their internals.

## What's in here

| File | Role |
| --- | --- |
| `DatabaseService.js` | The database service. A fail-fast MongoDB connection manager that reports health and emits connect/disconnect events. |
| `dbHealthServer.js` | A health **sidecar** that runs on the DB node so MongoDB becomes a network-reachable, health-reporting node. |
| `FailureDetector.js` | Timeout-based (heartbeat) failure detector: tracks nodes and moves them UP → SUSPECT → DOWN. |
| `HealthProbe.js` | Actively polls every node's `/health` and feeds results to the detector. |
| `healthRouter.js` | Express endpoints: `/health` (liveness), `/health/ready` (readiness), `/health/cluster` (whole-cluster view). |
| `dbGuard.js` | Middleware that returns a clean `503` for DB-dependent routes when the DB node is down, so **only** those features stop. |
| `monitor.js` | Standalone cluster monitor + live dashboard. The thing to keep on screen during the demo. |
| `config.js` | All topology/timing configuration, driven by environment variables. |
| `__tests__/` | Unit + failure-scenario tests (Jest). |

## How this achieves fault tolerance

1. **The database is its own node.** `mongod` runs separately; the app connects
   over the network. `dbHealthServer.js` runs next to `mongod` so the DB node
   answers `/health` even though `mongod` speaks no HTTP.
2. **Fail fast, don't hang.** `DatabaseService` disables command buffering and
   uses a short server-selection timeout, so when the DB node is unreachable,
   DB queries reject immediately instead of hanging.
3. **Degrade, don't crash.** `connectDB()` no longer calls `process.exit()` on a
   DB failure. The app node stays up; `dbGuard` returns `503` only for the
   routes that need the database; every other route keeps working.
4. **Detect failures.** The monitor actively probes each node. A crashed node
   stops answering and is marked `DOWN` after the timeout; a recovered node is
   marked `UP` again automatically.

## Prerequisites

- Node.js 18+ (project Dockerfile uses Node 24; tested on Node 22).
- A MongoDB instance for the DB node (local `mongod`, Docker, or Atlas).

## Configuration (environment variables)

See `.env.distributed.example`. The important ones:

```
MONGODB_URI=mongodb://localhost:27017/enrollment
VIEW_URL=http://localhost:4000
APP_URL=http://localhost:5000
DB_HEALTH_URL=http://localhost:6000
DB_HEALTH_PORT=6000
MONITOR_PORT=7000
HEARTBEAT_INTERVAL_MS=2000
SUSPECT_AFTER_MISSES=2
DOWN_AFTER_MISSES=4
```

On separate machines/VMs, set `*_URL` to the other nodes' addresses. On one
machine the localhost defaults just work.

## Running the nodes

**1. Database node** — start MongoDB, then the health sidecar next to it:

```bash
# terminal 1: the database itself
mongod --dbpath ./data --port 27017
# terminal 2: the DB health sidecar (makes the DB node observable)
NODE_ROLE=db DB_HEALTH_PORT=6000 MONGODB_URI=mongodb://localhost:27017/enrollment \
  node distributed/dbHealthServer.js
```

**2. App node** — the existing app, which now exposes `/health` and connects
through the fault-tolerant `DatabaseService`:

```bash
PORT=5000 MONGODB_URI=mongodb://localhost:27017/enrollment npm run start-server
```

**3. Cluster monitor** — watches everything and serves a dashboard:

```bash
NODE_ROLE=monitor MONITOR_PORT=7000 node distributed/monitor.js
# open http://localhost:7000/  (auto-refreshing dashboard)
# JSON snapshot at http://localhost:7000/health/cluster
```

## Running the tests

The subsystem has its own isolated Jest config (Node environment, no jsdom):

```bash
npx jest --config distributed/jest.config.cjs
```

All tests are deterministic and need **no** running database or network — clocks
and fetch are injected. `failureScenarios.test.js` is the one that directly
demonstrates the specification requirement (only the failed node's features stop).

## Simulating failures (for the demo)

With the three nodes and the monitor running:

- **Kill the DB node:** stop `mongod`. The monitor keeps the `db` sidecar `UP`
  but `/health/ready` on the DB node flips to `503`; DB-dependent routes on the
  app node return `503` while non-DB routes keep returning `200`. Kill the
  sidecar too and the monitor marks `db` `DOWN`.
- **Kill the app node:** stop the app process. The monitor marks `app` `DOWN`;
  the view node can show a degraded page for app-backed features.
- **Recover:** restart the process; the monitor marks the node `UP` again within
  a few seconds with no manual intervention.

The full, numbered test matrix (inputs, steps, expected results) is in
[`FAILURE_SCENARIOS.md`](./FAILURE_SCENARIOS.md).

## Applying the DB guard to real routes

Apply `dbGuard` only to routers/routes that touch the database, e.g.:

```js
import { createDbGuard } from './distributed/dbGuard.js';
import databaseService from './server/db/databaseService.js';

const requireDb = createDbGuard({ databaseService, featureName: 'Course enrollment' });
router.get('/api/courses', requireDb, coursesController.list);
router.post('/api/enroll', requireDb, enrollController.enroll);
// non-DB routes: no guard, so they keep working when the DB node is down.
```

## Notes on the bonus items (not implemented yet, by request)

- **Redundant persistence layer:** set `MONGODB_URI` to a replica-set string
  (`mongodb://m1,m2,m3/enrollment?replicaSet=rs0`). `DatabaseService` needs no
  code change; add the extra `mongod` services to compose and initiate the set.
- **Advanced consensus / detection:** swap the timeout logic in
  `FailureDetector` for a phi-accrual detector (same public API). See the note
  at the bottom of `FailureDetector.js`.
