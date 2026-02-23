/**
 * Catch-all para /api/* en Vercel.
 * Todas las rutas /api/health, /api/admin/login, etc. pasan al Express.
 */
export default async function handler(req, res) {
  const { default: app } = await import('../server/index.js');
  return app(req, res);
}
