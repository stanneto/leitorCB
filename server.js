'use strict';

const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3443);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CERT_DIR = path.join(ROOT_DIR, 'certs');
const TLS_KEY_PATH = process.env.HTTPS_KEY_PATH || path.join(CERT_DIR, 'localhost-key.pem');
const TLS_CERT_PATH = process.env.HTTPS_CERT_PATH || path.join(CERT_DIR, 'localhost.pem');

const VENDOR_CANDIDATES = {
  '/vendor/html5-qrcode.min.js': [
    path.join(ROOT_DIR, 'node_modules', 'html5-qrcode', 'html5-qrcode.min.js'),
    path.join(ROOT_DIR, 'node_modules', 'html5-qrcode', 'minified', 'html5-qrcode.min.js')
  ]
};

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function fileExists(targetPath) {
  try {
    return fs.statSync(targetPath).isFile();
  } catch (error) {
    return false;
  }
}

function getVendorFile(urlPathname) {
  const candidates = VENDOR_CANDIDATES[urlPathname];

  if (!candidates) {
    return null;
  }

  return candidates.find(fileExists) || null;
}

function getContentType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function safeResolvePublicFile(urlPathname) {
  const requestPath = urlPathname === '/' ? '/index.html' : urlPathname;
  const normalized = path.normalize(requestPath).replace(/^(\.\.[\\/])+/, '');
  const relativePath = normalized.replace(/^([\\/])+/, '');
  const resolved = path.join(PUBLIC_DIR, relativePath);

  if (!resolved.startsWith(PUBLIC_DIR)) {
    return null;
  }

  return resolved;
}

function sendFile(response, filePath, cacheControl) {
  const stream = fs.createReadStream(filePath);

  response.writeHead(200, {
    'Cache-Control': cacheControl,
    'Content-Type': getContentType(filePath)
  });

  stream.on('error', () => {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Falha ao ler o arquivo solicitado.');
  });

  stream.pipe(response);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(body, null, 2));
}

function getLocalNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const details of Object.values(interfaces)) {
    for (const item of details || []) {
      if (item.family === 'IPv4' && !item.internal) {
        addresses.push(item.address);
      }
    }
  }

  return [...new Set(addresses)];
}

function createServer() {
  const key = fs.readFileSync(TLS_KEY_PATH);
  const cert = fs.readFileSync(TLS_CERT_PATH);

  return https.createServer({ key, cert }, (request, response) => {
    const url = new URL(request.url, `https://${request.headers.host || 'localhost'}`);
    const { pathname } = url;

    if (pathname === '/health') {
      return sendJson(response, 200, {
        ok: true,
        https: true,
        port: PORT,
        host: HOST,
        networkAddresses: getLocalNetworkAddresses()
      });
    }

    const vendorFile = getVendorFile(pathname);

    if (vendorFile) {
      return sendFile(response, vendorFile, 'public, max-age=86400');
    }

    const publicFile = safeResolvePublicFile(pathname);

    if (!publicFile || !fileExists(publicFile)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Arquivo nao encontrado.');
      return;
    }

    return sendFile(response, publicFile, 'no-cache');
  });
}

function printStartupBanner() {
  const addresses = getLocalNetworkAddresses();

  console.log('');
  console.log('Leitor patrimonial HTTPS iniciado.');
  console.log(`Local:   https://localhost:${PORT}`);

  if (addresses.length > 0) {
    for (const address of addresses) {
      console.log(`Rede:    https://${address}:${PORT}`);
    }
  } else {
    console.log('Rede:    Nenhum IP local IPv4 foi encontrado.');
  }

  console.log('');
  console.log(`Certificado: ${TLS_CERT_PATH}`);
  console.log(`Chave:       ${TLS_KEY_PATH}`);
  console.log('');
}

if (!fileExists(TLS_KEY_PATH) || !fileExists(TLS_CERT_PATH)) {
  console.error('Certificados HTTPS nao encontrados.');
  console.error(`Esperado: ${TLS_KEY_PATH}`);
  console.error(`Esperado: ${TLS_CERT_PATH}`);
  console.error('Consulte o README para gerar os arquivos localhost-key.pem e localhost.pem.');
  process.exit(1);
}

const server = createServer();

server.listen(PORT, HOST, () => {
  printStartupBanner();
});

server.on('error', (error) => {
  console.error('Falha ao iniciar o servidor HTTPS.');
  console.error(error);
  process.exit(1);
});
