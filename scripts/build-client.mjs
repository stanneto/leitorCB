import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const watchMode = args.has('--watch');

const buildOptions = {
  bundle: true,
  charset: 'utf8',
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  entryPoints: [path.join(rootDir, 'src', 'main.jsx')],
  format: 'iife',
  logLevel: 'info',
  minify: true,
  outfile: path.join(rootDir, 'public', 'app.js'),
  platform: 'browser',
  sourcemap: true,
  target: ['chrome110', 'edge110', 'firefox110', 'ios15', 'safari15']
};

if (watchMode) {
  const context = await esbuild.context(buildOptions);
  await context.watch();
  console.log('Build React em modo watch ativo.');
} else {
  await esbuild.build(buildOptions);
}
