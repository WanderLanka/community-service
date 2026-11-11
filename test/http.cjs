const { once } = require('node:events');
module.exports = async function serve(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return (path, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { ...options, signal: AbortSignal.timeout(5000) });
};
