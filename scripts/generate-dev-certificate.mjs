import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import selfsigned from 'selfsigned';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDirectory, '..');
const targetDirectory = path.join(rootDir, 'certs');
const keyPath = path.join(targetDirectory, 'localhost-key.pem');
const certPath = path.join(targetDirectory, 'localhost.pem');

function getLocalIPv4Addresses() {
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

const localAddresses = getLocalIPv4Addresses();
const altNames = [
  { type: 2, value: 'localhost' },
  { type: 7, ip: '127.0.0.1' },
  ...localAddresses.map((address) => ({ type: 7, ip: address }))
];

const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems = selfsigned.generate(attrs, {
  algorithm: 'sha256',
  days: 365,
  keySize: 2048,
  extensions: [
    {
      name: 'basicConstraints',
      cA: false
    },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true
    },
    {
      name: 'subjectAltName',
      altNames
    }
  ]
});

fs.mkdirSync(targetDirectory, { recursive: true });
fs.writeFileSync(keyPath, pems.private, 'utf8');
fs.writeFileSync(certPath, pems.cert, 'utf8');

console.log('');
console.log('Certificado HTTPS gerado com sucesso.');
console.log(`Chave:       ${keyPath}`);
console.log(`Certificado: ${certPath}`);
console.log(`SAN DNS:     localhost`);
console.log(`SAN IPs:     ${['127.0.0.1', ...localAddresses].join(', ')}`);
console.log('');
console.log('Se o IP da sua maquina mudar, gere novamente o certificado.');
