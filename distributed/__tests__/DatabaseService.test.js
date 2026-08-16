/**
 * Unit tests for DatabaseService.
 * A fake mongoose is injected so we can exercise the status mapping, fail-fast
 * configuration, event emission, and ping logic without a real database.
 */
import { EventEmitter } from 'events';
import DatabaseService from '../DatabaseService.js';

/** Build a fake mongoose whose connection readyState and ping we control. */
function makeFakeMongoose({ readyState = 0, pingImpl } = {}) {
  const connection = new EventEmitter();
  connection.readyState = readyState;
  connection.db = {
    admin: () => ({
      ping: pingImpl || (async () => ({ ok: 1 })),
    }),
  };
  const mongoose = {
    connection,
    _settings: {},
    set(key, val) {
      this._settings[key] = val;
    },
    connect: jest.fn(async function (uri, opts) {
      mongoose._lastConnect = { uri, opts };
      connection.readyState = 1;
      return mongoose;
    }),
    disconnect: jest.fn(async function () {
      connection.readyState = 0;
    }),
  };
  return mongoose;
}

describe('DatabaseService', () => {
  test('requires a uri', () => {
    expect(() => new DatabaseService({})).toThrow();
  });

  test('connect() sets fail-fast options and passes the selection timeout', async () => {
    const mongoose = makeFakeMongoose();
    const db = new DatabaseService({
      uri: 'mongodb://localhost:27017/enrollment',
      serverSelectionTimeoutMs: 1234,
      mongoose,
    });
    const connected = jest.fn();
    db.on('connected', connected);

    await db.connect();

    expect(mongoose._settings.bufferCommands).toBe(false); // fail fast, never buffer
    expect(mongoose.connect).toHaveBeenCalledWith(
      'mongodb://localhost:27017/enrollment',
      expect.objectContaining({ serverSelectionTimeoutMS: 1234 }),
    );
    expect(connected).toHaveBeenCalled();
  });

  test('connect() rejects and emits "error" but does not exit on failure', async () => {
    const mongoose = makeFakeMongoose();
    mongoose.connect = jest.fn(async () => {
      throw new Error('server selection timed out');
    });
    const db = new DatabaseService({ uri: 'mongodb://down:27017/x', mongoose });
    const onError = jest.fn();
    db.on('db-error', onError);

    await expect(db.connect()).rejects.toThrow(/timed out/);
    expect(onError).toHaveBeenCalled();
    // getStatus should report not-ok / disconnected, not throw.
    const status = db.getStatus();
    expect(status.ok).toBe(false);
  });

  test('getStatus() maps readyState codes correctly', () => {
    const cases = [
      [0, 'disconnected', false],
      [1, 'connected', true],
      [2, 'connecting', false],
      [3, 'disconnecting', false],
    ];
    for (const [code, state, connected] of cases) {
      const mongoose = makeFakeMongoose({ readyState: code });
      const db = new DatabaseService({ uri: 'mongodb://x/y', mongoose });
      const status = db.getStatus();
      expect(status.state).toBe(state);
      expect(status.connected).toBe(connected);
    }
  });

  test('getStatus().ok is true only when connected AND last ping did not fail', async () => {
    const mongoose = makeFakeMongoose({ readyState: 1 });
    const db = new DatabaseService({ uri: 'mongodb://x/y', mongoose });
    expect(db.getStatus().ok).toBe(true); // connected, no failed ping yet

    // Simulate a failing ping (e.g. network partition while readyState lags).
    mongoose.connection.db.admin = () => ({
      ping: async () => {
        throw new Error('no primary available');
      },
    });
    const result = await db.ping();
    expect(result.ok).toBe(false);
    expect(db.getStatus().ok).toBe(false); // ping failure overrides readyState
  });

  test('ping() reports latency on success', async () => {
    const mongoose = makeFakeMongoose({ readyState: 1, pingImpl: async () => ({ ok: 1 }) });
    const db = new DatabaseService({ uri: 'mongodb://x/y', mongoose });
    const result = await db.ping();
    expect(result.ok).toBe(true);
    expect(typeof result.latencyMs).toBe('number');
  });

  test('disconnect() tears down and emits "disconnected"', async () => {
    const mongoose = makeFakeMongoose({ readyState: 1 });
    const db = new DatabaseService({ uri: 'mongodb://x/y', mongoose });
    const onDisc = jest.fn();
    db.on('disconnected', onDisc);
    await db.disconnect();
    expect(mongoose.disconnect).toHaveBeenCalled();
    expect(onDisc).toHaveBeenCalled();
  });
});
