/**
 * distributed/monitor.js
 * -----------------------------------------------------------------------------
 * Cluster monitor node.
 *
 * Wires a FailureDetector to a HealthProbe over the configured node list and
 * continuously reports the health of the whole cluster. It logs every state
 * transition (UP/SUSPECT/DOWN/recovered) with timestamps and serves a small
 * live dashboard at http://localhost:<MONITOR_PORT>/ plus the machine-readable
 * snapshot at /health/cluster.
 *
 * This is the process to keep on screen during the demo: start it, then kill a
 * node and watch that node turn red while the others stay green — a direct,
 * visual proof of failure detection and partial-failure tolerance.
 *
 *   NODE_ROLE=monitor MONITOR_PORT=7000 node distributed/monitor.js
 */

import express from 'express';
import { nodes, timing, derivedTimeouts, monitorPort } from './config.js';
import FailureDetector, { STATE } from './FailureDetector.js';
import HealthProbe from './HealthProbe.js';
import { createHealthRouter } from './healthRouter.js';

function ts() {
  return new Date().toISOString();
}

const detector = new FailureDetector({
  suspectTimeoutMs: derivedTimeouts.suspectTimeoutMs,
  downTimeoutMs: derivedTimeouts.downTimeoutMs,
});

const probe = new HealthProbe({
  detector,
  targets: nodes,
  intervalMs: timing.heartbeatIntervalMs,
  timeoutMs: timing.probeTimeoutMs,
});

// Log transitions so the terminal alone tells the fault-tolerance story.
detector.on('down', (id) => console.warn(`[${ts()}] DOWN     node=${id}`));
detector.on('suspect', (id) => console.warn(`[${ts()}] SUSPECT  node=${id}`));
detector.on('up', (id) => console.log(`[${ts()}] UP       node=${id}`));
detector.on('recovered', (id) => console.log(`[${ts()}] RECOVERED node=${id}`));

detector.start();
probe.start();

// ---- dashboard --------------------------------------------------------------

const app = express();
app.use(createHealthRouter({ role: 'monitor', detector }));

const COLORS = {
  [STATE.UP]: '#2e7d32',
  [STATE.SUSPECT]: '#f9a825',
  [STATE.DOWN]: '#c62828',
  [STATE.UNKNOWN]: '#757575',
};

app.get('/', (req, res) => {
  const snap = detector.snapshot();
  const rows = snap.nodes
    .map((n) => {
      const color = COLORS[n.state] || '#757575';
      const age = n.ageMs == null ? '—' : `${n.ageMs} ms ago`;
      const err = n.lastError ? ` <span style="color:#c62828">(${n.lastError})</span>` : '';
      return `<tr>
        <td>${n.id}</td>
        <td>${n.role || ''}</td>
        <td><span style="color:${color};font-weight:700">${n.state}</span></td>
        <td>${age}${err}</td>
      </tr>`;
    })
    .join('');

  res.status(200).send(`<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="refresh" content="1">
<title>Cluster Monitor</title>
<style>
  body{font-family:system-ui,Arial,sans-serif;margin:2rem;color:#222}
  table{border-collapse:collapse;width:100%;max-width:640px}
  th,td{text-align:left;padding:.5rem .75rem;border-bottom:1px solid #eee}
  th{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:#666}
  .summary{margin:.5rem 0 1rem;color:#444}
</style></head>
<body>
  <h1>Cluster Monitor</h1>
  <p class="summary">${snap.up} up · ${snap.suspect} suspect · ${snap.down} down &nbsp;|&nbsp; auto-refresh 1s</p>
  <table>
    <thead><tr><th>Node</th><th>Role</th><th>State</th><th>Last seen</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`);
});

app.listen(monitorPort, () => {
  console.log(`[monitor] watching ${nodes.length} nodes; dashboard at http://localhost:${monitorPort}/`);
  console.log(`[monitor] suspect after ${derivedTimeouts.suspectTimeoutMs}ms, down after ${derivedTimeouts.downTimeoutMs}ms`);
});
