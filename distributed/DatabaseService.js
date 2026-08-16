/**
 * distributed/DatabaseService.js
 * -----------------------------------------------------------------------------
 *
 * This is the single seam between the application node and the database node.
 * It owns the Mongoose connection and, crucially, is configured to FAIL FAST:
 *
 *   - bufferCommands = false           -> queries reject immediately instead of
 *                                         silently queueing forever when the DB
 *                                         node is unreachable.
 *   - serverSelectionTimeoutMS = small -> connection attempts give up quickly.
 *
 * That behaviour is what makes fault tolerance observable at the feature level:
 * when the DB node goes down, DB-dependent requests get a fast, clean error (so
 * the guard middleware can return "503 Service Unavailable") while every
 * feature that does NOT need the database keeps working normally.
 *
 * It also exposes getStatus()/ping() so the failure detector and the health
 * endpoints can report whether the database node is alive, and emits events on
 * connect/disconnect for anything that wants to react (failover, logging).
 *
 * REDUNDANCY (bonus): `uri` may be a replica-set connection string listing
 * several mongod hosts. The Mongo driver then performs automatic primary
 * election and failover for us; no change is needed in this file — only the URI
 * and the deployment. That keeps the redundant-persistence bonus a config task.
 *
 * Mongoose is injected (defaulting to the real module) so the status-mapping and
 * event logic can be unit-tested without a live database.
 */

import { EventEmitter } from 'events';
import realMongoose from 'mongoose';

// Mongoose connection.readyState codes.
export const READY_STATE = Object.freeze({
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
});

export class DatabaseService extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.uri                       Mongo connection string.
   * @param {number} [opts.serverSelectionTimeoutMs]
   * @param {number} [opts.pingIntervalMs]          Liveness ping cadence (0 = off).
   * @param {object} [opts.mongoose]                Injectable mongoose.
   */
  constructor({ uri, serverSelectionTimeoutMs = 1500, pingIntervalMs = 0, mongoose } = {}) {
    super();
    if (!uri) throw new Error('DatabaseService requires a uri');
    this.uri = uri;
    this.serverSelectionTimeoutMs = serverSelectionTimeoutMs;
    this.pingIntervalMs = pingIntervalMs;
    this.mongoose = mongoose || realMongoose;

    this._lastError = null;
    this._lastPingOk = null;
    this._lastPingLatencyMs = null;
    this._pingTimer = null;
    this._wired = false;
  }

  /**
   * Connect to the database node. Resolves on success; on failure it REJECTS
   * but does not crash the process — the caller (app node) can keep serving
   * non-DB routes and the connection will be retried by the driver.
   */
  async connect() {
    // Fail fast globally: never buffer commands while disconnected.
    this.mongoose.set('bufferCommands', false);
    this._wireConnectionEvents();

    try {
      await this.mongoose.connect(this.uri, {
        serverSelectionTimeoutMS: this.serverSelectionTimeoutMs,
      });
      this._lastError = null;
      this.emit('connected');
      if (this.pingIntervalMs > 0) this._startPingLoop();
      return true;
    } catch (err) {
      this._lastError = err;
      // NOTE: we deliberately emit 'db-error', NOT 'error'. Node's EventEmitter
      // throws (crashing the process) if an 'error' event is emitted with no
      // listener attached. For a fault-tolerance component that must survive the
      // database being unreachable, that footgun is unacceptable.
      this.emit('db-error', err);
      // Re-throw so callers can log it, but the process stays alive.
      throw err;
    }
  }

  /** Cleanly disconnect (used by tests and graceful shutdown). */
  async disconnect() {
    this._stopPingLoop();
    try {
      await this.mongoose.disconnect();
    } finally {
      this.emit('disconnected');
    }
  }

  /**
   * Actively verify the database node is alive with an admin ping. This is more
   * trustworthy than readyState alone, which can lag behind a real network
   * partition. Returns {ok, latencyMs, error}.
   */
  async ping() {
    const conn = this.mongoose.connection;
    const start = Date.now();
    try {
      if (!conn || !conn.db) throw new Error('no active connection');
      await conn.db.admin().ping();
      this._lastPingOk = true;
      this._lastPingLatencyMs = Date.now() - start;
      this._lastError = null;
      return { ok: true, latencyMs: this._lastPingLatencyMs };
    } catch (err) {
      this._lastPingOk = false;
      this._lastPingLatencyMs = null;
      this._lastError = err;
      return { ok: false, error: String(err.message || err) };
    }
  }

  /**
   * Synchronous status derived from the connection state. Safe to call very
   * frequently (used by /health). `ok` is true only when the driver reports a
   * live connection AND the most recent ping (if any) succeeded.
   */
  getStatus() {
    const conn = this.mongoose.connection || {};
    const code = typeof conn.readyState === 'number' ? conn.readyState : 0;
    const state = READY_STATE[code] || 'unknown';
    const connected = code === 1;
    const ok = connected && this._lastPingOk !== false;
    return {
      ok,
      connected,
      state,
      readyState: code,
      latencyMs: this._lastPingLatencyMs,
      lastError: this._lastError ? String(this._lastError.message || this._lastError) : null,
    };
  }

  // ---- internals ----------------------------------------------------------

  _wireConnectionEvents() {
    if (this._wired) return;
    const conn = this.mongoose.connection;
    if (!conn || typeof conn.on !== 'function') return;
    conn.on('connected', () => this.emit('connected'));
    conn.on('disconnected', () => this.emit('disconnected'));
    conn.on('reconnected', () => this.emit('reconnected'));
    conn.on('error', (err) => {
      // We listen to mongoose's connection 'error' (so mongoose does not crash)
      // and re-surface it as 'db-error' (so we do not crash either — see the
      // note in connect()).
      this._lastError = err;
      this.emit('db-error', err);
    });
    this._wired = true;
  }

  _startPingLoop() {
    if (this._pingTimer) return;
    this._pingTimer = setInterval(() => {
      this.ping().catch(() => {});
    }, this.pingIntervalMs);
    if (this._pingTimer.unref) this._pingTimer.unref();
  }

  _stopPingLoop() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }
}

export default DatabaseService;
