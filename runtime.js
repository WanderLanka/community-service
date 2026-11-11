const mongoose = require('mongoose');

function validateProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET === 'fallback-secret-key') {
    throw new Error('JWT_SECRET must contain at least 32 characters in production');
  }
  if (!Object.keys(process.env).some(key => /MONGO(?:DB)?_URI$/.test(key) && process.env[key])) {
    throw new Error('An explicit MongoDB URI is required in production');
  }
}

function installReadiness(app) {
  app.get('/ready', (req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' });
  });
}

async function start(app, { connect, port, host = process.env.HOST || '0.0.0.0', onStart }) {
  validateProductionConfig();
  await connect();
  const server = await new Promise((resolve, reject) => {
    const httpServer = app.listen(port, host, () => resolve(httpServer));
    httpServer.once('error', reject);
  });
  if (onStart) onStart();
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      const deadline = setTimeout(() => process.exit(1), 10000).unref();
      server.close(async () => {
        try { await mongoose.disconnect(); clearTimeout(deadline); process.exit(0); }
        catch { process.exit(1); }
      });
    });
  }
  return server;
}

module.exports = { start, installReadiness, validateProductionConfig };
