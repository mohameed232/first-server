const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { validateMetrics, createMonitor, POLL_MS, TIMEOUT_MS } = require('../public/monitoring.js');

const now = Date.parse('2026-10-16T12:00:00Z');
function sample() {
  return { cpu_percent: 25.5, memory: { percent: 75, used_bytes: 3 * 1024 ** 3, total_bytes: 4 * 1024 ** 3 },
    disk: { percent: 50, used_bytes: 20 * 1024 ** 3, total_bytes: 40 * 1024 ** 3 },
    uptime_seconds: 90061, timestamp: new Date(now).toISOString() };
}
const response = (body = sample()) => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body });
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness(fetchImpl = async () => response(), hidden = false) {
  const timers = new Map();
  const listeners = new Set();
  const states = [], received = [], requests = [];
  let id = 0;
  const visibility = { hidden, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  const monitor = createMonitor({ onData: (data) => received.push(data), onState: (state) => states.push(state),
    fetchImpl: (...args) => { requests.push(args); return fetchImpl(...args); }, visibility, now: () => now,
    schedule: (fn, delay) => { timers.set(++id, { fn, delay }); return id; }, cancel: (key) => timers.delete(key) });
  return { monitor, states, received, requests, timers,
    hide(value) { visibility.hidden = value; listeners.forEach((fn) => fn()); },
    fire(delay) { const timer = [...timers].find(([, value]) => value.delay === delay); assert.ok(timer); timers.delete(timer[0]); timer[1].fn(); } };
}

test('accepts only a valid aggregate schema, including zero usage', () => {
  assert.equal(validateMetrics(sample(), now).cpu_percent, 25.5);
  const value = sample(); value.cpu_percent = 0; value.memory.used_bytes = 0; value.memory.percent = 0;
  assert.equal(validateMetrics(value, now).memory.percent, 0);
});

for (const [name, edit] of Object.entries({
  missing: (x) => delete x.disk, negative: (x) => x.cpu_percent = -1,
  overflow: (x) => x.cpu_percent = 101, nan: (x) => x.cpu_percent = NaN,
  string: (x) => x.cpu_percent = '10', infinity: (x) => x.uptime_seconds = Infinity,
  negativeUptime: (x) => x.uptime_seconds = -1,
  impossibleCapacity: (x) => x.memory.used_bytes = x.memory.total_bytes + 1,
  zeroCapacity: (x) => x.disk.total_bytes = 0,
  inconsistentPercent: (x) => x.memory.percent = 10,
  unsafeInteger: (x) => x.disk.total_bytes = Number.MAX_SAFE_INTEGER + 1,
  staleTimestamp: (x) => x.timestamp = new Date(now - 61000).toISOString(),
  futureTimestamp: (x) => x.timestamp = new Date(now + 61000).toISOString(),
  invalidTimestamp: (x) => x.timestamp = 'invalid',
})) {
  test(`rejects ${name}`, () => { const value = sample(); edit(value); assert.throws(() => validateMetrics(value, now)); });
}

test('polls same-origin every five seconds without caching or overlapping', async () => {
  const h = harness(); h.monitor.start(); h.monitor.start(); await flush();
  assert.deepEqual(h.states, ['offline', 'live']);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0][0], '/api/metrics');
  assert.equal(h.requests[0][1].cache, 'no-store');
  assert.equal(h.received.length, 1);
  assert.equal(h.timers.size, 1);
  h.fire(POLL_MS); await flush(); assert.equal(h.received.length, 2);
  h.monitor.stop(); assert.equal(h.timers.size, 0);
});

test('HTTP, HTML fallback, network and schema errors become OFFLINE and recover', async () => {
  for (const fail of [async () => ({ ...response(), ok: false }),
    async () => ({ ...response(), headers: new Headers({ 'content-type': 'text/html' }) }),
    async () => { throw new Error('network'); }, async () => response({}),
    async () => ({ ...response(), json: async () => { throw new Error('bad JSON'); } })]) {
    let broken = true;
    const h = harness((...args) => broken ? fail(...args) : Promise.resolve(response()));
    h.monitor.start(); await flush();
    assert.equal(h.states.at(-1), 'offline'); assert.equal(h.received.length, 0);
    broken = false; h.fire(POLL_MS); await flush();
    assert.equal(h.states.at(-1), 'live'); h.monitor.stop();
  }
});

test('timeout covers stalled response bodies and aborts; late data is ignored', async () => {
  let finish;
  const h = harness(async () => ({ ...response(), json: () => new Promise((resolve) => { finish = resolve; }) }));
  h.monitor.start(); await flush();
  assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 1);
  h.fire(TIMEOUT_MS); await flush();
  assert.equal(h.requests[0][1].signal.aborted, true);
  assert.equal(h.states.at(-1), 'offline');
  finish(sample()); await flush(); assert.equal(h.received.length, 0);
  h.monitor.stop();
});

test('hidden page makes no requests and resumes immediately on visibility', async () => {
  const h = harness(undefined, true); h.monitor.start(); await flush();
  assert.equal(h.requests.length, 0); assert.equal(h.timers.size, 0);
  h.hide(false); await flush(); assert.equal(h.received.length, 1);
  h.hide(true); await flush(); assert.equal(h.states.at(-1), 'offline'); assert.equal(h.timers.size, 0);
  h.hide(false); await flush(); assert.equal(h.received.length, 2); h.monitor.stop();
});

test('hiding aborts pending requests and ignores their late completion', async () => {
  let finish;
  const h = harness(() => new Promise((resolve) => { finish = resolve; }));
  h.monitor.start(); h.hide(true); await flush();
  assert.equal(h.requests[0][1].signal.aborted, true);
  finish(response()); await flush();
  assert.equal(h.received.length, 0); assert.equal(h.timers.size, 0); h.monitor.stop();
});

test('dashboard renders real capacities and uptime, clears stale data, and works with reduced motion', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], {
    textContent: '', setAttribute() {}, addEventListener() {}, querySelector() { return null; },
    getContext() { return null; },
  }]));
  let chartClears = 0;
  const gradient = { addColorStop() {} };
  const context = new Proxy({}, { get: (_, prop) => prop === 'createLinearGradient' ? () => gradient
    : prop === 'clearRect' ? () => chartClears++ : () => {} });
  const chart = elements.get('signal-chart');
  chart.getContext = () => context;
  chart.getBoundingClientRect = () => ({ width: 900, height: 200 });
  let callbacks;
  const body = { dataset: {}, classList: { toggle() {} } };
  const sandbox = { document: { body, documentElement: {}, hidden: false,
    querySelector: (selector) => elements.get(selector.slice(1)), querySelectorAll: () => [], addEventListener() {} },
    window: { matchMedia: () => ({ matches: true, addEventListener() {} }), addEventListener() {} },
    requestAnimationFrame() {}, IntersectionObserver: class { observe() {} },
    Path2D: class { moveTo(x, y) { assert.ok(Number.isFinite(x) && Number.isFinite(y)); } lineTo() {} quadraticCurveTo() {} closePath() {} },
    NexusMonitoring: { createMonitor(options) { callbacks = options; return { start() { options.onState('offline'); }, stop() {} }; } },
  };
  vm.runInNewContext(fs.readFileSync('public/app.js', 'utf8'), sandbox);
  assert.equal(body.dataset.monitorState, 'offline');
  callbacks.onData(sample()); callbacks.onState('live');
  const text = (id) => elements.get(id).textContent;
  assert.equal(text('cpu-metric'), '25.5'); assert.equal(text('cpu-live'), '25.5');
  assert.equal(text('ram-metric'), '75.0'); assert.equal(text('disk-metric'), '50.0');
  assert.equal(text('memory-capacity'), '3.0 / 4.0 GiB');
  assert.equal(text('disk-capacity'), '20.0 / 40.0 GiB');
  assert.equal(text('server-uptime'), '1d 1h 1m'); assert.equal(text('server-time'), '12:00:00 UTC');
  assert.equal(text('monitor-status'), 'LIVE'); assert.ok(chartClears >= 3);
  for (let i = 0; i < 65; i++) callbacks.onData(sample());
  callbacks.onState('offline');
  for (const id of ['cpu-metric', 'ram-metric', 'disk-metric', 'server-uptime', 'server-time', 'cpu-live', 'ram-live']) assert.equal(text(id), '--');
  assert.equal(text('memory-capacity'), 'Unavailable'); assert.equal(text('monitor-status'), 'OFFLINE');
});
