// Self-hosted, dependency-free image host. Start with: npm start
import http from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.IMAGE_DIR || path.join(root, 'image-store'));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const maxBytes = Number(process.env.MAX_IMAGE_BYTES || 15 * 1024 * 1024);
const publicBase = (process.env.PUBLIC_BASE_URL || `http://${host}:${port}`).replace(/\/$/, '');
const allowed = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/gif', '.gif'],
  ['image/bmp', '.bmp'], ['image/x-ms-bmp', '.bmp'], ['image/tiff', '.tiff'], ['image/webp', '.webp'],
  ['image/avif', '.avif'], ['image/heic', '.heic'], ['image/heif', '.heic']
]);
await mkdir(dataDir, { recursive: true });

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}
function safeName(value) {
  return path.basename(String(value || 'image'))
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0, 180) || 'image';
}
function detectType(bytes) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  const head = bytes.subarray(0, 4).toString('ascii');
  if (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) return 'image/tiff';
  if (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a) return 'image/tiff'; return 'image/tiff';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, publicBase);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, publicBase, maxBytes });
    }
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const declared = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
      if (!allowed.has(declared)) {
        req.resume();
        return sendJson(res, 415, { error: 'Unsupported format. Choose JPG, PNG, GIF, BMP, TIFF, WEBP, AVIF, or HEIC.' });
      }
      const contentLength = Number(req.headers['content-length'] || 0);
      if (contentLength > maxBytes) {
        req.resume();
        return sendJson(res, 413, { error: `Image exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB limit.` });
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBytes) {
          req.resume();
          return sendJson(res, 413, { error: `Image exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB limit.` });
        }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (!bytes.length) return sendJson(res, 400, { error: 'The selected file is empty.' });
      const type = detectType(bytes);
      if (!type) return sendJson(res, 415, { error: 'File contents are not a supported image.' });
      const id = randomUUID();
      const diskName = id + allowed.get(type);
      await pipeline(Readable.from(bytes), createWriteStream(path.join(dataDir, diskName), { flags: 'wx' }));
      const filename = safeName(url.searchParams.get('filename'));
      const imageUrl = `${publicBase}/i/${id}/${encodeURIComponent(filename)}`;
      return sendJson(res, 201, {
        id, filename, size: bytes.length, contentType: type,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        url: imageUrl, hosted: true
      });
    }

    const match = url.pathname.match(/^\\/i\\/([a-f0-9-]{36})\\/(.*)$/i);
    if (req.method === 'GET' && match) {
      const id = match[1];
      let imagePath;
      for (const ext of new Set(allowed.values())) {
        try {
          imagePath = path.join(dataDir, id + ext);
          await stat(imagePath);
          break;
        } catch { imagePath = undefined; }
      }
      if (!imagePath) return sendJson(res, 404, { error: 'Image not found.' });
      const extension = path.extname(imagePath);
      const type = [...allowed.entries()].find(([, ext]) => ext === extension)?.[0] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff'
      });
      return createReadStream(imagePath).pipe(res);
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return createReadStream(path.join(root, 'public', 'index.html')).pipe(res);
    }
    return sendJson(res, 404, { error: 'Not found.' });
  } catch {
    if (!res.headersSent) sendJson(res, 500, { error: 'The image server encountered an error.' });
    else res.destroy();
  }
});

server.listen(port, host, () => {
  console.log(`Image URL app listening at http://${host}:${port}. Configure PUBLIC_BASE_URL for public links.`);
});
