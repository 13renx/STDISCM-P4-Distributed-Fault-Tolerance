/**
 * distributed/HealthProbe.js
 * -----------------------------------------------------------------------------
 * Active health probing.
 *
 * A FailureDetector only knows what it is told. This prober is the thing that
 * tells it: on a fixed interval it issues an HTTP GET to each node's /health
 * endpoint. A 2xx response counts as a heartbeat (detector.heartbeat); a
 * non-2xx, a network error, or a timeout counts as a failure
 * (detector.reportFailure), which lets the detector's timeout logic move the
 * node toward SUSPECT / DOWN.
 *
 * Using *active* probing (monitor pulls) rather than relying on nodes to push
 * heartbeats means a node that has completely crashed — and therefore cannot
 * push anything — is still detected, and there is no code to add to each node
 * beyond exposing /health.
 *
 * The fetch implementation is injectable so tests can drive it deterministically
 * without real sockets. In production it defaults to the global fetch (Node 18+).
 */

export class HealthProbe {
  /**
   * @param {object} opts
   * @param {import('./FailureDetector.js').FailureDetector} opts.detector
   * @param {Array<{id:string, healthUrl:string, role?:string, critical?:boolean}>} opts.targets
   * @param {number} opts.intervalMs      How often to probe each target.
   * @param {number} opts.timeoutMs       Per-probe timeout.
   * @param {typeof fetch} [opts.fetchFn]  Injectable fetch (defaults global fetch).
   */
  constructor({ detector, targets, intervalMs, timeoutMs, fetchFn } = {}) {
    if (!detector) throw new Error('HealthProbe requires a detector');
    if (!Array.isArray(targets)) throw new Error('HealthProbe requires a targets array');
    this.detector = detector;
    this.targets = targets;
    this.intervalMs = intervalMs || 2000;
    this.timeoutMs = timeoutMs || 1500;
    this.fetchFn = fetchFn || globalThis.fetch;
    if (typeof this.fetchFn !== 'function') {
      throw new Error('No fetch implementation available; pass opts.fetchFn');
    }
    this._timer = null;

    // Make sure every target is registered so it shows up in snapshots
    // immediately (as UNKNOWN) rather than only after the first probe.
    for (const t of this.targets) {
      this.detector.register(t.id, { role: t.role, critical: !!t.critical, healthUrl: t.healthUrl });
    }
  }

  /** Probe a single target once. Resolves to true on success, false otherwise. */
  async probeOnce(target) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(target.healthUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      if (res && res.ok) {
        let body = null;
        try {
          body = typeof res.json === 'function' ? await res.json() : null;
        } catch {
          body = null; // health endpoint returned non-JSON; still a live node.
        }
        this.detector.heartbeat(target.id, {
          role: target.role,
          ready: body && typeof body.ready === 'boolean' ? body.ready : undefined,
          deps: body && body.deps ? body.deps : undefined,
        });
        return true;
      }
      const status = res ? res.status : 'no response';
      this.detector.reportFailure(target.id, new Error(`health check returned ${status}`));
      return false;
    } catch (err) {
      const reason = err && err.name === 'AbortError' ? new Error('health check timed out') : err;
      this.detector.reportFailure(target.id, reason);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Probe every target once, concurrently. */
  async probeAll() {
    await Promise.all(this.targets.map((t) => this.probeOnce(t)));
  }

  /** Start the periodic probing loop. */
  start() {
    if (this._timer) return this;
    // Kick off an immediate round so state is fresh right away.
    this.probeAll().catch(() => {});
    this._timer = setInterval(() => {
      this.probeAll().catch(() => {});
    }, this.intervalMs);
    if (this._timer.unref) this._timer.unref();
    return this;
  }

  /** Stop probing. */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    return this;
  }
}

export default HealthProbe;
