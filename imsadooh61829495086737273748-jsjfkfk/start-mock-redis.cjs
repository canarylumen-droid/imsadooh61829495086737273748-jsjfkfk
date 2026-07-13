// Mock Redis server for local dev — no Redis installation needed
const net = require('net');

function r(str) {
  return str + '\r\n';
}

function bulk(v) {
  if (v === null) return '$-1\r\n';
  return '$' + Buffer.byteLength(v) + '\r\n' + v + '\r\n';
}

function integer(n) {
  return ':' + n + '\r\n';
}

function arrayEmpty() {
  return '*0\r\n';
}

const server = net.createServer((sock) => {
  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\r\n');
    buf = lines.pop() || '';

    for (const line of lines) {
      if (!line || line[0] !== '*') continue;
      const count = parseInt(line.slice(1), 10);
    }

    const raw = buf.includes('\n') ? buf : chunk.toString();
    const lower = raw.toLowerCase();
    let resp = '';

    if (lower.includes('ping')) resp = r('+PONG');
    else if (lower.includes('hello')) resp = r('+OK');
    else if (lower.includes('auth')) resp = r('+OK');
    else if (lower.includes('set') && !lower.includes('get')) resp = r('+OK');
    else if (lower.includes('get') && !lower.includes('set')) resp = bulk(null);
    else if (lower.includes('exists')) resp = integer(0);
    else if (lower.includes('del')) resp = integer(1);
    else if (lower.includes('expire')) resp = integer(1);
    else if (lower.includes('hset')) resp = integer(1);
    else if (lower.includes('hgetall')) resp = arrayEmpty();
    else if (lower.includes('hget')) resp = bulk(null);
    else if (lower.includes('zadd')) resp = integer(1);
    else if (lower.includes('zscore')) resp = bulk(null);
    else if (lower.includes('zrange')) resp = arrayEmpty();
    else if (lower.includes('sadd')) resp = integer(1);
    else if (lower.includes('srem')) resp = integer(1);
    else if (lower.includes('smembers')) resp = arrayEmpty();
    else if (lower.includes('lpush')) resp = integer(1);
    else if (lower.includes('lrange')) resp = arrayEmpty();
    else if (lower.includes('lpop') || lower.includes('rpop')) resp = bulk(null);
    else if (lower.includes('flush')) resp = r('+OK');
    else if (lower.includes('select')) resp = r('+OK');
    else if (lower.includes('client')) resp = r('+OK');
    else if (lower.includes('quit')) resp = r('+OK');
    else resp = r('+OK');

    try { sock.write(resp); } catch (e) {}
  });
  sock.on('error', () => {});
});

server.listen(6379, '127.0.0.1', () => {
  console.log('✅ Mock Redis listening on 127.0.0.1:6379');
  console.log('   Press Ctrl+C to stop');
});
