/**
 * Catch-all para /api/* en Vercel.
 * Espera a que Express termine de enviar la respuesta antes de cerrar la función.
 */
export default async function handler(req, res) {
  const { default: app } = await import('../server/index.js');
  return new Promise((resolve, reject) => {
    res.on('finish', resolve);
    res.on('error', reject);
    app(req, res);
  });
}
