/**
 * Unit tests for the FailureDetector.
 * A fake, manually-advanced clock makes state transitions deterministic with no
 * real waiting.
 */
import FailureDetector, { STATE } from '../FailureDetector.js';

function makeClock(start = 0) {
  const c = { t: start };
  c.now = () => c.t;
  c.advance = (ms) => {
    c.t += ms;
  };
  return c;
}

describe('FailureDetector', () => {
  const suspectTimeoutMs = 1000;
  const downTimeoutMs = 2000;

  test('rejects invalid thresholds', () => {
    expect(() => new FailureDetector({ suspectTimeoutMs: 0, downTimeoutMs: 1 })).toThrow();
    expect(() => new FailureDetector({ suspectTimeoutMs: 100, downTimeoutMs: 50 })).toThrow();
  });

  test('a newly registered node is UNKNOWN until first heartbeat', () => {
    const clock = makeClock();
    const fd = new FailureDetector({ suspectTimeoutMs, downTimeoutMs, now: clock.now });
    fd.register('app', { role: 'app' });
    expect(fd.stateOf('app')).toBe(STATE.UNKNOWN);
    fd.evaluate();
    expect(fd.stateOf('app')).toBe(STATE.UNKNOWN); // no heartbeat => stays UNKNOWN
  });

  test('heartbeat marks a node UP and emits "up"', () => {
    const clock = makeClock();
    const fd = new FailureDetector({ suspectTimeoutMs, downTimeoutMs, now: clock.now });
    const upEvents = [];
    fd.on('up', (id) => upEvents.push(id));
    fd.heartbeat('app', { role: 'app' });
    expect(fd.stateOf('app')).toBe(STATE.UP);
    expect(fd.isUp('app')).toBe(true);
    expect(upEvents).toEqual(['app']);
  });

  test('transitions UP -> SUSPECT -> DOWN as time passes without heartbeats', () => {
    const clock = makeClock();
    const fd = new FailureDetector({ suspectTimeoutMs, downTimeoutMs, now: clock.now });
    const transitions = [];
    fd.on('change', (id, next) => transitions.push(next));

    fd.heartbeat('db');
    expect(fd.stateOf('db')).toBe(STATE.UP);

    clock.advance(1500); // past suspect (1000), before down (2000)
    fd.evaluate();
    expect(fd.stateOf('db')).toBe(STATE.SUSPECT);

    clock.advance(1000); // now 2500 total, past down
    fd.evaluate();
    expect(fd.stateOf('db')).toBe(STATE.DOWN);

    expect(transitions).toEqual([STATE.UP, STATE.SUSPECT, STATE.DOWN]);
  });

  test('a heartbeat after DOWN recovers the node and emits "recovered"', () => {
    const clock = makeClock();
    const fd = new FailureDetector({ suspectTimeoutMs, downTimeoutMs, now: clock.now });
    const recovered = [];
    fd.on('recovered', (id) => recovered.push(id));

    fd.heartbeat('db');
    clock.advance(3000);
    fd.evaluate();
    expect(fd.stateOf('db')).toBe(STATE.DOWN);

    fd.heartbeat('db'); // node came back
    expect(fd.stateOf('db')).toBe(STATE.UP);
    expect(recovered).toEqual(['db']);
  });

  test('reportFailure records the error but does not force DOWN before timeout', () => {
    const clock = makeClock();
    const fd = new FailureDetector({ suspectTimeoutMs, downTimeoutMs, now: clock.now });
    fd.heartbeat('app');
    fd.reportFailure('app', new Error('connection refused'));
    // Still within suspect window, so a single failure keeps it UP (jitter tolerance).
    expect(fd.stateOf('app')).toBe(STATE.UP);
    const snap = fd.snapshot();
    expect(snap.nodes.find((n) => n.id === 'app').lastError).toBe('connection refused');
  });

  test('snapshot summarises cluster counts', () => {
    const clock = makeClock();
    const fd = new FailureDetector({ suspectTimeoutMs, downTimeoutMs, now: clock.now });
    fd.heartbeat('view');
    fd.heartbeat('app');
    fd.heartbeat('db');
    clock.advance(3000);
    fd.reportFailure('db'); // triggers immediate re-eval of db
    fd.evaluate();
    // view + app still evaluated at same advanced time => also DOWN here;
    // to isolate, re-heartbeat view/app to keep them UP:
    fd.heartbeat('view');
    fd.heartbeat('app');
    fd.evaluate();

    const snap = fd.snapshot();
    expect(snap.total).toBe(3);
    expect(snap.up).toBe(2);
    expect(snap.down).toBe(1);
    expect(snap.nodes.find((n) => n.id === 'db').state).toBe(STATE.DOWN);
  });

  test('start()/stop() run periodic evaluation with real timers', async () => {
    jest.useFakeTimers();
    const realNow = { t: 0, now() { return this.t; } };
    const fd = new FailureDetector({
      suspectTimeoutMs,
      downTimeoutMs,
      evaluateIntervalMs: 200,
      now: () => realNow.t,
    });
    fd.heartbeat('app');
    fd.start();
    realNow.t = 2500; // simulate time passing beyond down threshold
    jest.advanceTimersByTime(200); // let one evaluate tick fire
    expect(fd.stateOf('app')).toBe(STATE.DOWN);
    fd.stop();
    jest.useRealTimers();
  });
});
