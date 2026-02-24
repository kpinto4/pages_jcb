/**
 * Handler unificado para Express en Vercel.
 * Carga la app una sola vez y espera correctamente a que la respuesta termine.
 */

let appPromise = null;

function getApp() {
  if (!appPromise) {
    appPromise = import('../../server/index.js').then((m) => m.default);
  }
  return appPromise;
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    await new Promise((resolve, reject) => {
      const onFinish = () => {
        cleanup();
        resolve();
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        res.off('finish', onFinish);
        res.off('close', onFinish);
        res.off('error', onError);
      };
      res.once('finish', onFinish);
      res.once('close', onFinish);
      res.once('error', onError);
      app(req, res);
    });
  } catch (err) {
    console.error('[API] Handler error:', err?.message || err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Error interno del servidor' }));
    }
  }
}
