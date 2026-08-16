/**
 * Failure-scenario tests (Person C - Lance).
 * -----------------------------------------------------------------------------
 * These are the tests that directly demonstrate the core requirement from the
 * specification:
 *
 *   "When a node is down, only the features supported by that node should stop
 *    working, but the rest of the application should still work."
 *
 * We build a small Express app that mirrors the real app node's wiring:
 *   - the health router (liveness/readiness),
 *   - one DB-dependent route protected by the dbGuard,
 *   - one non-DB route with no guard,
 * then flip a fake database service between "up" and "down" and assert the
 * behaviour of each endpoint. We also test the cluster-level detection path.
 */
import express from 'express';
import request from 'supertest';

import { createHealthRouter } from '../healthRouter.js';
import { createDbGuard } from '../dbGuard.js';
import FailureDetector, { STATE } from '../FailureDetector.js';
import HealthProbe from '../HealthProbe.js';

/** A fake database service whose health we toggle in tests. */
function makeFakeDb(initialOk = true) {
  let ok = initialOk;
  return {
    setOk(v) {
      ok = v;
    },
    getStatus() {
      return ok
        ? { ok: true, connected: true, state: 'connected', readyState: 1, lastError: null }
        : { ok: false, connected: false, state: 'disconnected', readyState: 0, lastError: 'connection refused' };
    },
    async ping() {
      return ok ? { ok: true, latencyMs: 1 } : { ok: false, error: 'connection refused' };
    },
  };
}

/** Build an app node wired like the real one, using the given fake DB. */
function buildAppNode(fakeDb) {
  const app = express();
  app.use(express.json());

  app.use(
    createHealthRouter({
      role: 'app',
      dependencies: {
        db: async () => fakeDb.getStatus(),
      },
    }),
  );

  const dbGuard = createDbGuard({ databaseService: fakeDb, featureName: 'Course enrollment' });

  // DB-DEPENDENT feature (e.g. list courses / enroll / grades): guarded.
  app.get('/api/courses', dbGuard, (req, res) => {
    res.status(200).json({ courses: ['CS101', 'CS102'] });
  });

  // NON-DB feature (e.g. static info / health of a stateless endpoint): unguarded.
  app.get('/api/ping', (req, res) => {
    res.status(200).json({ pong: true });
  });

  return app;
}

describe('Failure scenario: database node DOWN', () => {
  test('when DB is UP, every feature works', async () => {
    const db = makeFakeDb(true);
    const app = buildAppNode(db);

    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('up');
    expect(health.body.ready).toBe(true);

    expect((await request(app).get('/health/ready')).status).toBe(200);
    expect((await request(app).get('/api/courses')).status).toBe(200);
    expect((await request(app).get('/api/ping')).status).toBe(200);
  });

  test('when DB is DOWN, DB features stop but the app node stays alive and non-DB features still work', async () => {
    const db = makeFakeDb(true);
    const app = buildAppNode(db);

    // Simulate the database node going down.
    db.setOk(false);

    // LIVENESS still 200 — the app NODE has not crashed, only its DB dependency.
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('up');
    expect(health.body.ready).toBe(false); // but it is not READY to serve DB work
    expect(health.body.deps.db.ok).toBe(false);

    // READINESS flips to 503 so a load balancer can route away from DB work.
    expect((await request(app).get('/health/ready')).status).toBe(503);

    // The DB-dependent feature returns a clean 503, not a hang or a 500.
    const courses = await request(app).get('/api/courses');
    expect(courses.status).toBe(503);
    expect(courses.body.code).toBe('DB_UNAVAILABLE');

    // THE KEY ASSERTION: a feature that does not need the DB is unaffected.
    const ping = await request(app).get('/api/ping');
    expect(ping.status).toBe(200);
    expect(ping.body.pong).toBe(true);
  });

  test('recovery: once the DB node returns, DB features work again', async () => {
    const db = makeFakeDb(false);
    const app = buildAppNode(db);

    expect((await request(app).get('/api/courses')).status).toBe(503);

    db.setOk(true); // DB node recovers.

    expect((await request(app).get('/api/courses')).status).toBe(200);
    expect((await request(app).get('/health/ready')).status).toBe(200);
  });
});

describe('Failure scenario: cluster-level detection', () => {
  test('detector marks the crashed node DOWN while the others stay UP', async () => {
    const detector = new FailureDetector({ suspectTimeoutMs: 40, downTimeoutMs: 80 });

    // Fake fetch: app + view answer 200, db refuses (simulating a crashed node).
    const fetchFn = async (url) => {
      if (url.includes('//db/')) throw new Error('ECONNREFUSED');
      return { ok: true, status: 200, json: async () => ({ ready: true }) };
    };

    const probe = new HealthProbe({
      detector,
      targets: [
        { id: 'view', role: 'view', healthUrl: 'http://view/health' },
        { id: 'app', role: 'app', healthUrl: 'http://app/health' },
        { id: 'db', role: 'db', healthUrl: 'http://db/health', critical: true },
      ],
      intervalMs: 10,
      timeoutMs: 10,
      fetchFn,
    });

    // Probe repeatedly and let time pass so the db node crosses the DOWN timeout.
    for (let i = 0; i < 6; i++) {
      await probe.probeAll();
      await new Promise((r) => setTimeout(r, 20));
    }
    detector.evaluate();

    const snap = detector.snapshot();
    expect(detector.stateOf('app')).toBe(STATE.UP);
    expect(detector.stateOf('view')).toBe(STATE.UP);
    expect(detector.stateOf('db')).toBe(STATE.DOWN);
    expect(snap.up).toBe(2);
    expect(snap.down).toBe(1);
  });

  test('the monitor exposes the cluster snapshot at /health/cluster', async () => {
    const detector = new FailureDetector({ suspectTimeoutMs: 1000, downTimeoutMs: 2000 });
    detector.heartbeat('app', { role: 'app' });
    detector.heartbeat('view', { role: 'view' });

    const monitor = express();
    monitor.use(createHealthRouter({ role: 'monitor', detector }));

    const res = await request(monitor).get('/health/cluster');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.up).toBe(2);
    expect(res.body.nodes.map((n) => n.id).sort()).toEqual(['app', 'view']);
  });
});
