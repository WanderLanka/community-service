const jwt = require('jsonwebtoken');
const { timingSafeEqual } = require('node:crypto');

function verifyAccess(token, secret) {
  const user = jwt.verify(token, secret, { algorithms: ['HS256'] });
  if (!user || !user.userId || user.type === 'refresh') throw new jwt.JsonWebTokenError('Access token required');
  return user;
}

function requireInternal(req, res, next) {
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  const supplied = req.headers['x-internal-token'];
  if (!expected) return res.status(503).json({ success: false, error: 'Internal authentication is not configured' });
  if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.status(401).json({ success: false, error: 'Internal authentication required' });
  }
  return next();
}

module.exports = { verifyAccess, requireInternal };
