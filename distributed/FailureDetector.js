/**
 * distributed/FailureDetector.js
 * -----------------------------------------------------------------------------
 * A timeout-based (heartbeat) failure detector.
 *
 * WHAT IT DOES
 *   Tracks a set of nodes. Every time a node is "seen" (a heartbeat arrives, or
 *   an active health probe succeeds) we record the timestamp. Periodically we
 *   compare each node's age (now - lastSeen) against two thresholds:
 *
 *       age <= suspectTimeout                    -> UP
 *       suspectTimeout < age <= downTimeout      -> SUSPECT
 *       age > downTimeout                        -> DOWN
 *
 *   Transitions between states emit events ('up', 'suspect', 'down', 'recovered')
 *   so other parts of the system (monitor, failover logic, dashboards) can react.
 *
 * WHY THIS ALGORITHM
 *   This is the classic heartbeat + timeout detector used in distributed
 *   systems. The SUSPECT state is a grace period that absorbs transient network
 *   jitter and prevents a single dropped packet from flapping a node to DOWN.
 *   It is intentionally simple and deterministic. (The bonus "advanced
 *   consensus / detection" upgrade path is a phi-accrual detector, which
 *   replaces the hard timeout with an accumulating suspicion value based on the
 *   observed distribution of inter-arrival times — see NOTES at the bottom.)
 *
 * TESTABILITY
 *   The clock is injectable (`now`), so tests can advance time deterministically
 *   without real waiting. No network or DB dependencies live in this file.
 */

import { EventEmitter } from 'events';

export const STATE = Object.freeze({
  UP: 'UP',
  SUSPECT: 'SUSPECT',
  DOWN: 'DOWN',
  UNKNOWN: 'UNKNOWN', // registered but never yet seen
});

export class FailureDetector extends EventEmitter {
  /**
   * @param {object} opts
   * @param {number} opts.suspectTimeoutMs  Age after which a node is SUSPECT.
   * @param {number} opts.downTimeoutMs     Age after which a node is DOWN.
   * @param {number} [opts.evaluateIntervalMs] How often start() re-evaluates.
   * @param {() => number} [opts.now]        Clock function (defaults Date.now).
   */
  constructor({ suspectTimeoutMs, downTimeoutMs, evaluateIntervalMs, now } = {}) {
    super();
    if (!(suspectTimeoutMs > 0) || !(downTimeoutMs > 0)) {
      throw new Error('FailureDetector requires positive suspectTimeoutMs and downTimeoutMs');
    }
    if (downTimeoutMs <= suspectTimeoutMs) {
      throw new Error('downTimeoutMs must be greater than suspectTimeoutMs');
    }
    this.suspectTimeoutMs = suspectTimeoutMs;
    this.downTimeoutMs = downTimeoutMs;
    this.evaluateIntervalMs = evaluateIntervalMs || Math.max(250, Math.floor(suspectTimeoutMs / 2));
    this.now = now || Date.now;

    /** @type {Map<string, {id:string, meta:object, lastSeen:number|null, state:string, lastError:string|null}>} */
    this.nodes = new Map();
    this._timer = null;
  }

  /** Register a node to be monitored. Idempotent. */
  register(id, meta = {}) {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, {
        id,
        meta,
        lastSeen: null,
        // When a node has never been seen, we cannot time from a last success,
        // so we time from the first failed probe instead. This lets a node that
        // is down from the very start still be marked DOWN (rather than staying
        // UNKNOWN forever) once probes have been failing past the down timeout.
        firstFailureAt: null,
        state: STATE.UNKNOWN,
        lastError: null,
      });
    } else {
      // Merge metadata on re-register.
      Object.assign(this.nodes.get(id).meta, meta);
    }
    return this;
  }

  /** Stop tracking a node. */
  unregister(id) {
    this.nodes.delete(id);
    return this;
  }

  /**
   * Record that a node was successfully seen. This is the "heartbeat".
   * Called by HealthProbe on a successful probe, or by a push endpoint.
   */
  heartbeat(id, meta = {}) {
    if (!this.nodes.has(id)) this.register(id, meta);
    const node = this.nodes.get(id);
    node.lastSeen = this.now();
    node.firstFailureAt = null; // a success resets the never-seen failure clock.
    node.lastError = null;
    if (meta && Object.keys(meta).length) Object.assign(node.meta, meta);
    this._applyState(node, STATE.UP);
    return this;
  }

  /**
   * Record that a probe/heartbeat attempt failed. This does NOT immediately mark
   * the node DOWN (that is governed by the timeout so a single blip is tolerated)
   * but it stores the error and forces an immediate re-evaluation so the node
   * moves toward SUSPECT/DOWN promptly once the timeout elapses.
   */
  reportFailure(id, error) {
    if (!this.nodes.has(id)) this.register(id);
    const node = this.nodes.get(id);
    node.lastError = error ? String(error.message || error) : 'probe failed';
    // If we have never had a success, start the down clock from the first failure.
    if (node.lastSeen == null && node.firstFailureAt == null) {
      node.firstFailureAt = this.now();
    }
    this._evaluateNode(node);
    return this;
  }

  /** Current state of a single node. */
  stateOf(id) {
    const node = this.nodes.get(id);
    return node ? node.state : undefined;
  }

  /** True only if the node is fully UP. */
  isUp(id) {
    return this.stateOf(id) === STATE.UP;
  }

  /** A serialisable snapshot of the whole cluster's health. */
  snapshot() {
    const t = this.now();
    const nodes = [...this.nodes.values()].map((n) => ({
      id: n.id,
      role: n.meta.role || null,
      state: n.state,
      lastSeen: n.lastSeen,
      ageMs: n.lastSeen == null ? null : t - n.lastSeen,
      lastError: n.lastError,
    }));
    return {
      timestamp: t,
      total: nodes.length,
      up: nodes.filter((n) => n.state === STATE.UP).length,
      down: nodes.filter((n) => n.state === STATE.DOWN).length,
      suspect: nodes.filter((n) => n.state === STATE.SUSPECT).length,
      nodes,
    };
  }

  /** Re-evaluate every node once (compare age to thresholds). */
  evaluate() {
    for (const node of this.nodes.values()) this._evaluateNode(node);
    return this;
  }

  /** Begin periodic evaluation. */
  start() {
    if (this._timer) return this;
    this._timer = setInterval(() => this.evaluate(), this.evaluateIntervalMs);
    // Do not keep the Node.js event loop alive solely for this timer.
    if (this._timer.unref) this._timer.unref();
    return this;
  }

  /** Stop periodic evaluation. */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    return this;
  }

  // ---- internals ----------------------------------------------------------

  _evaluateNode(node) {
    let reference = node.lastSeen;
    if (reference == null) {
      if (node.firstFailureAt == null) {
        // Never seen and never probed: no information yet, stay UNKNOWN.
        return;
      }
      // Never seen but probes are failing: time from the first failure.
      reference = node.firstFailureAt;
    }
    const age = this.now() - reference;
    let next;
    if (age <= this.suspectTimeoutMs) next = STATE.UP;
    else if (age <= this.downTimeoutMs) next = STATE.SUSPECT;
    else next = STATE.DOWN;
    this._applyState(node, next);
  }

  _applyState(node, next) {
    const prev = node.state;
    if (prev === next) return;
    node.state = next;

    // Emit a specific event for the transition, plus a generic 'change'.
    if (next === STATE.UP) {
      // Coming back from DOWN/SUSPECT is a recovery worth a dedicated event.
      if (prev === STATE.DOWN || prev === STATE.SUSPECT) {
        this.emit('recovered', node.id, node);
      }
      this.emit('up', node.id, node);
    } else if (next === STATE.SUSPECT) {
      this.emit('suspect', node.id, node);
    } else if (next === STATE.DOWN) {
      this.emit('down', node.id, node);
    }
    this.emit('change', node.id, next, prev, node);
  }
}

export default FailureDetector;

/*
 * NOTES — path to the bonus "advanced consensus / detection":
 *   phi-accrual failure detector (Hayashibara et al., 2004). Instead of a hard
 *   timeout, it records the history of heartbeat inter-arrival times, models
 *   them as a distribution, and outputs a continuous suspicion level phi. A node
 *   is suspected when phi crosses a configurable threshold. Benefits: adapts to
 *   changing network conditions and lets each consumer pick its own
 *   sensitivity. This class exposes the same register/heartbeat/snapshot API, so
 *   swapping in a phi-accrual implementation later would not change callers.
 */
