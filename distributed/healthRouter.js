/**
 * distributed/healthRouter.js
 * -----------------------------------------------------------------------------
 * Health endpoints mounted on every node so the failure detector (and humans)
 * can inspect it over HTTP.
 *
 * Three endpoints, following the standard liveness/readiness split:
 *
 *   GET /health         LIVENESS. 200 as long as this process is running. The
 *                       failure detector probes THIS to decide UP/DOWN. It
 *                       reports dependency status in the body but stays 200 even
 *                       when a dependency is down — a node with a dead DB is
 *                       still itself alive, and we must not let "DB down" make
 *                       the detector think the *app* node crashed.
 *
 *   GET /health/ready   READINESS. 200 only when all critical dependencies are
 *                       healthy, else 503. Load balancers / the view node use
 *                       this to decide whether to send traffic here.
 *
 *   GET /health/cluster CLUSTER VIEW. The failure detector's snapshot of every
 *                       node (only meaningful on the monitor node, but harmless
 *                       elsewhere — returns just this node if no detector).
 *
 * The router is intentionally generic: pass in this node's role and a set of
 * dependency probes. A dependency probe is `() => ({ ok, ... })`.
 */

import express from 'express';

/**
 * @param {object} opts
 * @param {string} opts.role                         Role label for this node.
 * @param {Record<string, () => object|Promise<object>>} [opts.dependencies]
 *        Map of dependency name -> probe returning at least { ok:boolean }.
 * @param {import('./FailureDetector.js').FailureDetector} [opts.detector]
 *        Optional; enables /health/cluster.
 * @param {() => number} [opts.now]
 */
export function createHealthRouter({ role, dependencies = {}, detector = null, now = Date.now } = {}) {
  const router = express.Router();
  const startedAt = now();

  async function evaluateDeps() {
    const entries = await Promise.all(
      Object.entries(dependencies).map(async ([name, probe]) => {
        try {
          const result = await probe();
          return [name, result || { ok: false }];
        } catch (err) {
          return [name, { ok: false, error: String(err.message || err) }];
        }
      }),
    );
    return Object.fromEntries(entries);
  }

  // LIVENESS — always 200 if the process can answer.
  router.get('/health', async (req, res) => {
    const deps = await evaluateDeps();
    const ready = Object.values(deps).every((d) => d && d.ok);
    res.status(200).json({
      status: 'up',
      role,
      ready,
      uptimeMs: now() - startedAt,
      timestamp: now(),
      deps,
    });
  });

  // READINESS — 503 when a critical dependency is down.
  router.get('/health/ready', async (req, res) => {
    const deps = await evaluateDeps();
    const ready = Object.values(deps).every((d) => d && d.ok);
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not-ready',
      role,
      timestamp: now(),
      deps,
    });
  });

  // CLUSTER — the detector's whole-cluster view (for the monitor / demo).
  router.get('/health/cluster', (req, res) => {
    if (!detector) {
      return res.status(200).json({
        note: 'no failure detector attached to this node',
        role,
        timestamp: now(),
      });
    }
    res.status(200).json(detector.snapshot());
  });

  return router;
}

export default createHealthRouter;
