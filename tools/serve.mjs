// tools/serve.mjs: zero-dependency static file server for the repo root.
//
// ES modules do not load from file://, so the game is always served over HTTP.
//   node tools/serve.mjs            -> http://localhost:8770/
//   PORT=9000 node tools/serve.mjs  -> http://localhost:9000/   (PORT=0 picks a free port)
// Other tools import { startServer } and pass port 0 to get a free port.
//
// Safety: GET/HEAD only; the decoded path must stay inside the repo root both lexically and after
// realpath (so a symlink cannot lead outside); dot-segments (.git, .out, .env ...) are refused; only
// regular files are served.

import http from 'node:http';
import { promises as fs, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
export const DEFAULT_PORT = 8770;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

function inside(child, parent) {
  if (child === parent) return true;
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

async function handle(req, res, root) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method Not Allowed\n', { Allow: 'GET, HEAD' });
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad Request\n');
  }
  if (pathname.includes('\0')) return send(res, 400, 'Bad Request\n');
  const segments = pathname.split('/').filter(Boolean);
  if (segments.some((s) => s.startsWith('.'))) return send(res, 403, 'Forbidden\n');

  let file = path.resolve(root, '.' + path.sep + segments.join(path.sep));
  if (!inside(file, root)) return send(res, 403, 'Forbidden\n');

  let real;
  try {
    real = await fs.realpath(file);
  } catch {
    return send(res, 404, 'Not Found\n');
  }
  if (!inside(real, root)) return send(res, 403, 'Forbidden\n');

  let st = await fs.stat(real);
  if (st.isDirectory()) {
    file = path.join(real, 'index.html');
    try {
      real = await fs.realpath(file);
      st = await fs.stat(real);
    } catch {
      return send(res, 404, 'Not Found\n');
    }
    if (!inside(real, root)) return send(res, 403, 'Forbidden\n');
  }
  if (!st.isFile()) return send(res, 404, 'Not Found\n');

  const type = MIME[path.extname(real).toLowerCase()] || 'application/octet-stream';
  const body = req.method === 'HEAD' ? null : await fs.readFile(real);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': st.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

/** Start the server. Resolves to { server, port, url } once it is listening. */
export function startServer({ port = DEFAULT_PORT, root = ROOT, host = '127.0.0.1' } = {}) {
  const server = http.createServer((req, res) => {
    handle(req, res, root).catch(() => {
      if (!res.headersSent) send(res, 500, 'Internal Server Error\n');
      else res.destroy();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const actual = server.address().port;
      resolve({ server, port: actual, url: `http://127.0.0.1:${actual}/` });
    });
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  const envPort = process.env.PORT;
  const port = envPort !== undefined && envPort !== '' ? Number(envPort) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`serve: invalid PORT "${envPort}"`);
    process.exit(1);
  }
  startServer({ port })
    .then(({ server, url }) => {
      console.log(`serving ${ROOT} at ${url} (also http://localhost:${server.address().port}/)  Ctrl+C to stop`);
      const stop = () => server.close(() => process.exit(0));
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      process.on('SIGHUP', stop);
    })
    .catch((err) => {
      console.error(`serve: ${err.code === 'EADDRINUSE' ? `port ${port} is already in use` : err.message}`);
      process.exit(1);
    });
}
