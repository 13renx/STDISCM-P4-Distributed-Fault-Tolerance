/**
 * distributed/dbGuard.js
 * -----------------------------------------------------------------------------
 * Express middleware factory that makes DB-dependent features degrade
 * gracefully when the database node is down.
 *
 * The specification requires: "When a node is down, only the features supported
 * by that node should stop working, but the rest of the application should still
 * work." This middleware is the enforcement point for the database node: apply
 * it ONLY to routers/routes that actually need the database (enroll, view
 * grades, upload grades, list courses). Routes that do not touch the DB simply
 * do not use it and therefore keep serving normally while the DB is down.
 *
 * When the DB is unavailable it responds with 503 Service Unavailable:
 *   - JSON for API/XHR requests,
 *   - a rendered 'handling' page for normal browser navigations,
 * so the failure is clean and user-visible instead of a hang or a 500.
 *
 * @param {object} opts
 * @param {import('./DatabaseService.js').DatabaseService} opts.databaseService
 * @param {string} [opts.featureName]  Friendly name used in the message.
 */
export function createDbGuard({ databaseService, featureName = 'This feature' } = {}) {
  if (!databaseService) throw new Error('createDbGuard requires a databaseService');

  return function dbGuard(req, res, next) {
    const status = databaseService.getStatus();
    if (status.ok) return next();

    const message =
      `${featureName} is temporarily unavailable because the database node is unreachable. ` +
      `Other parts of the site are still working — please try again shortly.`;

    // Decide response shape: API/XHR gets JSON, a browser navigation gets a page.
    const wantsJson =
      req.xhr ||
      req.path.startsWith('/api') ||
      (req.get('accept') || '').includes('application/json');

    if (wantsJson) {
      return res.status(503).json({ error: message, code: 'DB_UNAVAILABLE' });
    }

    // Render the existing error page if the view engine is available.
    try {
      return res.status(503).render('handling', {
        title: 'Service Temporarily Unavailable',
        body: message,
      });
    } catch {
      return res.status(503).send(message);
    }
  };
}

export default createDbGuard;
