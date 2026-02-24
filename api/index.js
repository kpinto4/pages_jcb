/**
 * Handler de Vercel: redirige todas las peticiones al backend Express.
 * Las rutas /api/* se sirven desde aquí.
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
// En Vercel, que Node resuelva módulos desde la raíz (pg, express, etc.)
const nodeModules = path.join(root, 'node_modules');
if (!process.env.NODE_PATH) process.env.NODE_PATH = nodeModules;
else if (!process.env.NODE_PATH.includes(nodeModules)) process.env.NODE_PATH = nodeModules + path.delimiter + process.env.NODE_PATH;

export default async function handler(req, res) {
  const { default: app } = await import('../server/index.js');
  return new Promise((resolve, reject) => {
    res.on('finish', resolve);
    res.on('error', reject);
    app(req, res);
  });
}
