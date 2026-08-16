# Integration Notes (for the team's review)


## 1. `server/DbConnect.js` (modified)

`connectDB()` keeps the exact same name and import path, so nothing that imports
it breaks. Two behavioural changes:

- It now **awaits** the connection and reports real success/failure (the
  original logged "Connected to MongoDB" before the connection actually
  resolved).
- It **no longer calls `process.exit(1)`** when the database is unreachable.
  Exiting would take the whole app node down whenever the DB node is down, which
  violates the requirement that non-DB features keep working. Instead it logs
  and lets the app keep serving; the driver reconnects in the background.

It delegates to the shared `DatabaseService` singleton so there is one
connection and one source of truth for DB health.

## 2. `server/db/databaseService.js` (new)

Exports the single shared `DatabaseService` instance for the app node. Import it
wherever you need DB health:

```js
import databaseService from './server/db/databaseService.js';
const { ok } = databaseService.getStatus();
```

## 3. `index.js` (modified)

Two additions, clearly commented:

- Imports the health router + the DB service singleton.
- Mounts the health endpoints (`/health`, `/health/ready`, `/health/cluster`)
  **before** the feature routers.

No existing route, middleware, or view was changed or removed.

## Applying the DB guard (optional, where you own the routes)

To make a DB-dependent feature degrade gracefully, wrap just that
route with the guard. Non-DB routes need nothing.

```js
import { createDbGuard } from './distributed/dbGuard.js';
import databaseService from './server/db/databaseService.js';

const requireDb = createDbGuard({ databaseService, featureName: 'Course enrollment' });
router.post('/api/enroll', requireDb, enrollController.enroll);
```

## Nothing was added to `package.json`

The subsystem uses only `express` and `mongoose`, which the project already
depends on. The test-only dependency is `supertest`; add it under
`devDependencies` if you want to run `failureScenarios.test.js` in CI:

```
npm install --save-dev supertest
```
