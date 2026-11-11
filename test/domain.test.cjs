const { test } = require('node:test');
const assert = require('node:assert/strict');

test('community role policy prevents ordinary users from moderation', () => {
  const { verifyRole } = require('../middleware/auth');
  let status;
  verifyRole(['admin'])({ user: { role: 'traveller' } }, { status(c) { status = c; return this; }, json() {} }, () => assert.fail('role guard bypassed'));
  assert.equal(status, 403);
  let allowed = false;
  verifyRole(['admin'])({ user: { role: 'admin' } }, {}, () => { allowed = true; });
  assert.equal(allowed, true);
});

test('community map points retain a geospatial index', () => {
  const Model = require('../models/MapPoint');
  assert.ok(Model.schema.indexes().some(([fields]) => fields.location === '2dsphere'));
});
