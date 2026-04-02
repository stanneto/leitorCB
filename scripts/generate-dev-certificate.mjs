import { existsSync, mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const certDir = join(projectRoot, 'certs');
const keyPath = join(certDir, 'dev-key.pem');
const certPath = join(certDir, 'dev-cert.pem');

function collectIpv4Addresses() {
  const interfaces = networkInterfaces();
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

function findOpenssl() {
  const candidates = [
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe',
    'C:\\Program Files\\OpenSSL-Win32\\bin\\openssl.exe'
  ];

  return candidates.find((candidate) => {
    if (candidate === 'openssl') {
      const probe = spawnSync(candidate, ['version'], { stdio: 'ignore', shell: true });
      return probe.status === 0;
    }

    return existsSync(candidate);
  }) || null;
}

const opensslPath = findOpenssl();

if (!opensslPath) {
  console.error('OpenSSL nao foi encontrado. Instale o Git for Windows com OpenSSL ou o OpenSSL do sistema e rode novamente.');
  process.exit(1);
}

mkdirSync(certDir, { recursive: true });

const subjectAltNames = ['DNS:localhost', 'IP:127.0.0.1', ...collectIpv4Addresses().map((address) => `IP:${address}`)];
const commandArgs = [
  'req',
  '-x509',
  '-nodes',
  '-newkey',
  'rsa:2048',
  '-sha256',
  '-days',
  '825',
  '-keyout',
  keyPath,
  '-out',
  certPath,
  '-subj',
  '/CN=localhost',
  '-addext',
  `subjectAltName=${subjectAltNames.join(',')}`
];

const result = spawnSync(opensslPath, commandArgs, {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: opensslPath === 'openssl'
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log('');
console.log('Certificado gerado com sucesso:');
console.log(`- Chave: ${keyPath}`);
console.log(`- Certificado: ${certPath}`);
console.log('Use npm start para iniciar em HTTPS automaticamente quando esses arquivos existirem.');
