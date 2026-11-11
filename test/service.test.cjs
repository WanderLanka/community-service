const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'automated-test-secret-with-at-least-32-characters';
process.env.INTERNAL_SERVICE_TOKEN = 'automated-internal-secret-with-at-least-32-characters';
process.env.MONGO_URI = 'mongodb://127.0.0.1:1/unused';
const jwt = require('jsonwebtoken');
const app = require('../index.js');
const serve = require('./http.cjs');
const { verifyAccess, requireInternal } = require('../security');
const payload = { userId: '507f1f77bcf86cd799439011', username: 'test-user', role: 'traveller' };

test('application imports without connecting or opening a listener; liveness responds', async t => {
  const request = await serve(t, app);
  const response = await request('/health');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /json/);
});

test('readiness fails while database is disconnected', async t => {
  const request = await serve(t, app);
  const response = await request('/ready');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).status, 'not_ready');
});

test('access tokens authenticate; refresh, expired and wrong-key tokens do not', () => {
  const secret = process.env.JWT_SECRET;
  assert.equal(verifyAccess(jwt.sign(payload, secret), secret).userId, payload.userId);
  assert.throws(() => verifyAccess(jwt.sign({ ...payload, type: 'refresh' }, secret), secret));
  assert.throws(() => verifyAccess(jwt.sign(payload, secret, { expiresIn: -1 }), secret));
  assert.throws(() => verifyAccess(jwt.sign(payload, 'different-key'), secret));
  assert.throws(() => verifyAccess(jwt.sign({ role: 'guide' }, secret), secret));
});

test('internal authentication denies absent and wrong credentials and accepts configured credential', () => {
  for (const supplied of [undefined, 'bad-key']) {
    let status;
    const res = { status(code) { status = code; return this; }, json() {} };
    requireInternal({ headers: { 'x-internal-token': supplied } }, res, () => assert.fail('unauthorized request advanced'));
    assert.equal(status, 401);
  }
  let passed = false;
  requireInternal({ headers: { 'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN } }, {}, () => { passed = true; });
  assert.equal(passed, true);
});

test('production config rejects missing secrets and database configuration', () => {
  const { validateProductionConfig } = require('../runtime');
  const env = { ...process.env };
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    assert.throws(validateProductionConfig, /JWT_SECRET/);
    process.env.JWT_SECRET = env.JWT_SECRET;
    for (const key of Object.keys(process.env)) if (/MONGO(?:DB)?_URI$/.test(key)) delete process.env[key];
    assert.throws(validateProductionConfig, /MongoDB URI/);
    process.env.MONGO_URI = env.MONGO_URI;
    assert.doesNotThrow(validateProductionConfig);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});

test('protected endpoint rejects missing, refresh, expired and malformed tokens before database access', async t => {
  const request = await serve(t, app);
  const tokens = [null, 'invalid-token', jwt.sign({ ...payload, type: 'refresh' }, process.env.JWT_SECRET), jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: -1 })];
  for (const token of tokens) {
    const response = await request('/posts', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    assert.ok([400, 401, 403].includes(response.status), `unexpected status ${response.status}`);
  }
});
