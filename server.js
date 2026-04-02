'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CERT_DIR = path.join(ROOT_DIR, 'certs');
const HTTPS_KEY_PATH = process.env.HTTPS_KEY_PATH || path.join(CERT_DIR, 'dev-key.pem');
const HTTPS_CERT_PATH = process.env.HTTPS_CERT_PATH || path.join(CERT_DIR, 'dev-cert.pem');
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

function loadHttpsCredentials() {
  if (String(process.env.HTTPS || '').toLowerCase() === 'false') {
    return null;
  }

  if (!fileExists(HTTPS_KEY_PATH) || !fileExists(HTTPS_CERT_PATH)) {
    return null;
  }

  return {
    key: fs.readFileSync(HTTPS_KEY_PATH),
    cert: fs.readFileSync(HTTPS_CERT_PATH)
  };
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

function createRequestListener(httpsEnabled) {
  return (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const { pathname } = url;

    if (pathname === '/health') {
      return sendJson(response, 200, {
        ok: true,
        https: httpsEnabled,
        port: PORT,
        host: HOST,
        networkAddresses: getLocalNetworkAddresses()
      });
    }

    const publicFile = safeResolvePublicFile(pathname);

    if (!publicFile || !fileExists(publicFile)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Arquivo nao encontrado.');
      return;
    }

    return sendFile(response, publicFile, 'no-cache');
  };
}

function printStartupBanner(httpsEnabled) {
  const addresses = getLocalNetworkAddresses();
  const protocol = httpsEnabled ? 'https' : 'http';

  console.log('');
  console.log(`Leitor Codigo de Barras ${httpsEnabled ? 'HTTPS' : 'HTTP'} iniciado.`);
  console.log(`Local:   ${protocol}://localhost:${PORT}`);

  if (addresses.length > 0) {
    for (const address of addresses) {
      console.log(`Rede:    ${protocol}://${address}:${PORT}`);
    }
  } else {
    console.log('Rede:    Nenhum IP local IPv4 foi encontrado.');
  }

  if (!httpsEnabled) {
    console.log('');
    console.log('Aviso: o iPhone costuma exigir HTTPS para liberar a camera fora de localhost.');
    console.log('Execute `npm run cert` para gerar um certificado local de desenvolvimento.');
  }
  console.log('');
}

const httpsCredentials = loadHttpsCredentials();
const server = httpsCredentials
  ? https.createServer(httpsCredentials, createRequestListener(true))
  : http.createServer(createRequestListener(false));

server.listen(PORT, HOST, () => {
  printStartupBanner(Boolean(httpsCredentials));
});

server.on('error', (error) => {
  console.error('Falha ao iniciar o servidor.');
  console.error(error);
  process.exit(1);
});
