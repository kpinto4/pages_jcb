/**
 * Handler de Vercel: redirige todas las peticiones al backend Express.
 * Las rutas /api/* se sirven desde aquí.
 */
export default async function handler(req, res) {
  const { default: app } = await import('../server/index.js');
  return app(req, res);
}
