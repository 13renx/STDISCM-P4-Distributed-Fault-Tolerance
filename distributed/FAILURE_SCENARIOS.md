# Failure Scenario Test Matrix 

This is the manual test plan that backs the video demonstration. It proves the
core specification requirement:

> When a node is down, only the features supported by that node should stop
> working, but the rest of the application should still work.

Each scenario lists the action, the expected observable result, and how to
verify it. The automated equivalents live in
`distributed/__tests__/failureScenarios.test.js`.

## Baseline (all nodes up)

**Setup:** DB node (`mongod` + sidecar), app node, view node, and the monitor
all running.

| Check | Command | Expected |
| --- | --- | --- |
| Monitor dashboard | open `http://<monitor>:7000/` | all nodes green (UP) |
| Cluster snapshot | `curl <monitor>:7000/health/cluster` | `up` = node count, `down` = 0 |
| DB-dependent feature | list courses / enroll / view grades | works (`200`) |
| Non-DB feature | any static/stateless route | works (`200`) |
| App readiness | `curl <app>:5000/health/ready` | `200` |

---

## Scenario 1 — Database node goes DOWN (the key scenario)

**Action:** stop `mongod` on the DB node (leave the sidecar running for step A,
then optionally stop the sidecar for step B).

### A. `mongod` stopped, sidecar still running

| Check | Expected |
| --- | --- |
| App liveness `GET <app>/health` | `200` — the app node has **not** crashed |
| App readiness `GET <app>/health/ready` | `503` — not ready for DB work |
| `<app>/health` body `deps.db.ok` | `false` |
| DB-dependent feature (enroll, courses, grades) | `503` "temporarily unavailable", clean error (not a hang, not a 500) |
| **Non-DB feature** | still `200` — **unaffected** |
| DB node sidecar `GET <db>:6000/health/ready` | `503`, `deps.mongo.ok = false` |
| Monitor | `db` still UP (sidecar answers), readiness shows the DB problem |

### B. Whole DB node down (also stop the sidecar)

| Check | Expected |
| --- | --- |
| Monitor | `db` transitions UP → SUSPECT → DOWN within the timeout |
| Cluster snapshot | `db` state = `DOWN`, `lastError` populated |
| App node & non-DB features | still up and serving |

**Verify:** the app process log shows it stayed alive ("app will keep serving
non-DB routes"); no `process.exit`.

---

## Scenario 2 — Database node RECOVERS

**Action:** restart `mongod` (and the sidecar if it was stopped).

| Check | Expected |
| --- | --- |
| App readiness `/health/ready` | returns to `200` automatically (no app restart) |
| DB-dependent feature | works again (`200`) |
| Monitor | `db` transitions back to UP; a `RECOVERED` line is logged |

**Why it recovers on its own:** the Mongo driver reconnects in the background;
the sidecar retries its initial connection every few seconds;
`DatabaseService.getStatus()` reflects the live state; `dbGuard` stops returning
`503` as soon as status is OK again.

---

## Scenario 3 — App node goes DOWN

**Action:** stop the app node process.

| Check | Expected |
| --- | --- |
| Monitor | `app` transitions UP → SUSPECT → DOWN |
| View node | app-backed pages show a degraded/error state; non-app pages still render |
| DB node & monitor | unaffected, still UP |

**Recovery:** restart the app process → monitor marks `app` UP again.

---

## Scenario 4 — View node goes DOWN

**Action:** stop the view node process.

| Check | Expected |
| --- | --- |
| Monitor | `view` transitions to DOWN |
| App API (`<app>:5000/...`) | still reachable directly (`200`) |
| DB node | unaffected |

---

## Scenario 5 — Cluster-level detection accuracy

**Action:** with all nodes up, kill exactly one node.

| Check | Expected |
| --- | --- |
| Cluster snapshot | exactly the killed node is `DOWN`; all others remain `UP` |
| False positives | none — healthy nodes are never marked down by one node's failure |

This isolation (one node down ≠ whole cluster down) is the essence of the
partial-failure tolerance the specification asks for, and is asserted
automatically in `failureScenarios.test.js`
("detector marks the crashed node DOWN while the others stay UP").

---

## Mapping to automated tests

| Scenario | Automated test |
| --- | --- |
| 1 (DB down, features isolated) | `failureScenarios.test.js` → "when DB is DOWN, DB features stop but the app node stays alive and non-DB features still work" |
| 2 (recovery) | `failureScenarios.test.js` → "recovery: once the DB node returns, DB features work again" |
| 5 (cluster isolation) | `failureScenarios.test.js` → "detector marks the crashed node DOWN while the others stay UP" |
| detector transitions | `FailureDetector.test.js` (UP→SUSPECT→DOWN, recovery) |
| probe behaviour | `HealthProbe.test.js` (2xx, non-2xx, error, timeout) |
| DB status/fail-fast | `DatabaseService.test.js` |
