/**
 * Unit tests for HealthProbe.
 * A fake fetch lets us simulate healthy nodes, error responses, and timeouts
 * deterministically and assert how the detector is updated.
 */
import FailureDetector, { STATE } from '../FailureDetector.js';
import HealthProbe from '../HealthProbe.js';

function makeDetector() {
  return new FailureDetector({ suspectTimeoutMs: 1000, downTimeoutMs: 2000 });
}

const targets = [
  { id: 'app', role: 'app', healthUrl: 'http://app/health' },
  { id: 'db', role: 'db', healthUrl: 'http://db/health', critical: true },
];

describe('HealthProbe', () => {
  test('registers all targets on construction (visible before first probe)', () => {
    const detector = makeDetector();
    // eslint-disable-next-line no-new
    new HealthProbe({ detector, targets, fetchFn: async () => ({ ok: true, json: async () => ({}) }) });
    const ids = detector.snapshot().nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['app', 'db']);
  });

  test('a 2xx response records a heartbeat (node UP)', async () => {
    const detector = makeDetector();
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ ready: true }) });
    const probe = new HealthProbe({ detector, targets, fetchFn });
    const ok = await probe.probeOnce(targets[0]);
    expect(ok).toBe(true);
    expect(detector.stateOf('app')).toBe(STATE.UP);
  });

  test('a non-2xx response is a failure', async () => {
    const detector = makeDetector();
    const fetchFn = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const probe = new HealthProbe({ detector, targets, fetchFn });
    const ok = await probe.probeOnce(targets[1]);
    expect(ok).toBe(false);
    const node = detector.snapshot().nodes.find((n) => n.id === 'db');
    expect(node.lastError).toMatch(/503/);
  });

  test('a thrown network error is a failure', async () => {
    const detector = makeDetector();
    const fetchFn = async () => {
      throw new Error('ECONNREFUSED');
    };
    const probe = new HealthProbe({ detector, targets, fetchFn });
    const ok = await probe.probeOnce(targets[0]);
    expect(ok).toBe(false);
    const node = detector.snapshot().nodes.find((n) => n.id === 'app');
    expect(node.lastError).toMatch(/ECONNREFUSED/);
  });

  test('an aborted (timed-out) probe is reported as a timeout failure', async () => {
    const detector = makeDetector();
    const fetchFn = async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    };
    const probe = new HealthProbe({ detector, targets, fetchFn, timeoutMs: 5 });
    const ok = await probe.probeOnce(targets[1]);
    expect(ok).toBe(false);
    const node = detector.snapshot().nodes.find((n) => n.id === 'db');
    expect(node.lastError).toMatch(/timed out/);
  });

  test('probeAll probes every target', async () => {
    const detector = makeDetector();
    const seen = [];
    const fetchFn = async (url) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const probe = new HealthProbe({ detector, targets, fetchFn });
    await probe.probeAll();
    expect(seen.sort()).toEqual(['http://app/health', 'http://db/health']);
    expect(detector.isUp('app')).toBe(true);
    expect(detector.isUp('db')).toBe(true);
  });
});
