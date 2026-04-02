import os from 'os';

const interfaces = os.networkInterfaces();
const results = [];

for (const details of Object.values(interfaces)) {
  for (const item of details || []) {
    if (item.family === 'IPv4' && !item.internal) {
      results.push(item.address);
    }
  }
}

if (results.length === 0) {
  console.log('Nenhum IP local IPv4 encontrado.');
} else {
  for (const address of [...new Set(results)]) {
    console.log(address);
  }
}
