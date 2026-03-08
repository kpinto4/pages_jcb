import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDb } from './db-adapter.js';
import { randomUUID, createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

/** Convierte BigInt y otros valores no serializables para res.json() (p. ej. Neon/pg devuelve id como BigInt). */
function toJSONSafe(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(toJSONSafe);
  if (typeof obj === 'object' && obj.constructor === Object) {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = toJSONSafe(obj[k]);
    return out;
  }
  return obj;
}

const uploadsDir = path.join(__dirname, 'public', 'uploads');
try {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
} catch (e) {
  console.warn('No se pudo crear uploadsDir:', e.message);
}

let db;
let dbInitError = null;
try {
  db = await initDb();
} catch (err) {
  console.error('DB init failed:', err.message);
  dbInitError = err.message || String(err);
  db = null;
}

// En Supabase/Neon, seed inicial de stiker_slots si está vacío
if (db && process.env.DATABASE_URL) {
  try {
    const count = await db.get('SELECT COUNT(*) as n FROM stiker_slots');
    if (Number(count?.n || 0) === 0) {
      const nums = Array.from({ length: 10000 }, (_, i) => i.toString().padStart(4, '0'));
      for (let i = nums.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [nums[i], nums[j]] = [nums[j], nums[i]];
      }
      for (let i = 0; i < 5000; i++) {
        await db.run('INSERT INTO stiker_slots (numero_a, numero_b) VALUES (?, ?)', nums[2 * i], nums[2 * i + 1]);
      }
      console.log('Seed: 5000 stiker_slots creados en Supabase.');
    }
  } catch (e) {
    console.warn('Seed stiker_slots:', e.message);
  }
}
// Auto-limpieza de órdenes pendientes expiradas al arrancar (se ejecuta una vez al inicio y cada hora)
async function scheduleCleanup() {
  if (!db) return;
  try {
    const n = await limpiarPendientesExpirados(120);
    if (n > 0) console.log(`Auto-limpieza al arrancar: ${n} órdenes pendientes expiradas liberadas.`);
  } catch (e) {
    console.warn('Auto-limpieza pendientes:', e.message);
  }
  // Repetir cada hora
  setTimeout(scheduleCleanup, 60 * 60 * 1000);
}

const app = express();
const port = process.env.PORT || 3000;

// ----- Wompi (Colombia) — única pasarela de pago -----
const wompiPublicKey = (process.env.WOMPI_PUBLIC_KEY || '').trim();
const wompiIntegritySecret = (process.env.WOMPI_INTEGRITY_SECRET || '').trim();
const wompiEventsSecret = (process.env.WOMPI_EVENTS_SECRET || '').trim();
const wompiCheckoutUrl = (process.env.WOMPI_CHECKOUT_URL || 'https://checkout.wompi.co/p/').trim();
/** Si definido, se usa esta URL como redirect. Si no, cuando successUrl sea localhost usamos la de Wompi para evitar 403. */
const wompiRedirectOverride = (process.env.WOMPI_REDIRECT_URL_OVERRIDE || '').trim();
/** URL pública del frontend (ej. tu ngrok del puerto 4200). Si la defines, al pagar desde localhost Wompi redirigirá aquí en lugar de a la página de Wompi. */
const wompiSuccessUrlOverride = (process.env.WOMPI_SUCCESS_URL || '').trim();
const wompiRedirectFallback = 'https://transaction-redirect.wompi.co/check';
const wompiEnabled = !!(wompiPublicKey && wompiIntegritySecret);

/** Firma de integridad Wompi (Colombia): SHA256(Reference + Amount + Currency + IntegritySecret). Orden exacto según docs. */
function wompiSignature(reference, amountInCents, currency) {
  const amountStr = String(Math.round(Number(amountInCents)));
  const str = `${reference}${amountStr}${currency}${wompiIntegritySecret}`;
  return createHash('sha256').update(str).digest('hex');
}
// ----- Acceso admin (obligatorio) -----
const adminPassword = (process.env.ADMIN_PASSWORD || '').trim();
const rawJwt = (process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || '').trim();
const jwtSecret = rawJwt || adminPassword || '';
const jwtSecretFinal = jwtSecret || 'change-me-in-production';

if (process.env.NODE_ENV === 'production') {
  if (!adminPassword) {
    console.error('ADMIN_PASSWORD es obligatoria en producción. Define ADMIN_PASSWORD en server/.env');
    process.exit(1);
  }
  if (!jwtSecret || jwtSecret === 'change-me-in-production') {
    console.error('JWT_SECRET o ADMIN_PASSWORD deben estar definidos en server/.env para las sesiones de admin.');
    process.exit(1);
  }
} else {
  if (!adminPassword) console.warn('⚠️  ADMIN_PASSWORD no definida. El panel /admin no permitirá login.');
  if (!jwtSecret || jwtSecret === 'change-me-in-production') console.warn('⚠️  JWT_SECRET no definido. Se usará fallback; define JWT_SECRET en .env para producción.');
}
const isPg = !!process.env.DATABASE_URL;
const dateCmpEq = isPg ? '(fecha::date) = (?::date)' : 'date(fecha) = date(?)';
const dateCmpGt = isPg ? '(fecha::date) > (?::date)' : 'date(fecha) > date(?)';

// CORS: en producción define ALLOWED_ORIGIN (ej. https://tudominio.com). En desarrollo acepta cualquier origen.
const corsOrigin = process.env.ALLOWED_ORIGIN || true;
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());
// Si la DB no cargó, solo permitir health y admin/login
app.use((req, res, next) => {
  if (!db && (req.path !== '/api/health' || req.method !== 'GET') && !(req.path === '/api/admin/login' && req.method === 'POST')) {
    return res.status(503).json({
      error: 'Base de datos no disponible',
      detail: dbInitError || undefined
    });
  }
  next();
});
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, randomUUID() + (path.extname(file.originalname) || '.jpg').toLowerCase())
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ----- RAÍZ (para que no salga "Cannot GET /" al abrir la URL del servidor) -----
app.get('/', (req, res) => {
  res.json({
    app: 'Juego de la Ciudad Bonita — API',
    message: 'Backend en ejecución. La app web consume /api/*.',
    health: '/api/health'
  });
});

// ----- HEALTH -----
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    wompi: wompiEnabled,
    adminConfigured: !!process.env.ADMIN_PASSWORD,
    hasDatabase: !!process.env.DATABASE_URL,
    dbConnected: !!db,
    dbError: dbInitError || undefined
  });
});

// ----- ADMIN LOGIN (público, antes del middleware) -----

app.post('/api/admin/login', (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const password = (typeof body.password === 'string' ? body.password : String(body.password || '')).trim();

    if (!adminPassword) {
      return res.status(503).json({ error: 'Admin no configurado. Define ADMIN_PASSWORD en server/.env' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Falta la contraseña' });
    }
    if (password !== adminPassword) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    const token = jwt.sign(
      { sub: 'admin', role: 'admin' },
      jwtSecretFinal,
      { expiresIn: '24h' }
    );
    res.json({ token });
  } catch (err) {
    console.error('Error login:', err?.message || err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// Middleware: proteger todas las rutas /api/admin/* excepto POST /api/admin/login
function adminAuthMiddleware(req, res, next) {
  if (req.path === '/login' && req.method === 'POST') return next();

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'No autorizado. Inicia sesión en /admin' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecretFinal);
    req.admin = decoded;
    next();
  } catch (err) {
    const message = err?.name === 'TokenExpiredError'
      ? 'Sesión expirada. Vuelve a iniciar sesión.'
      : 'Sesión inválida. Vuelve a iniciar sesión.';
    return res.status(401).json({ error: message });
  }
}

app.use('/api/admin', adminAuthMiddleware);

// URL pública del backend (para devolver URLs de /uploads que el front pueda cargar). En despliegue pon ej. http://n1.voriamtechnologies.com:3012
const publicApiUrl = (process.env.PUBLIC_API_URL || '').trim();

// ----- ADMIN: subir imagen (para premio mayor) -----
app.post('/api/admin/upload-image', upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se envió ningún archivo. Usa el campo "image".' });
    const baseUrl = publicApiUrl || (req.protocol + '://' + req.get('host'));
    const url = baseUrl + '/uploads/' + req.file.filename;
    res.json({ url });
  } catch (err) {
    console.error('Error upload imagen:', err);
    res.status(500).json({ error: err.message || 'Error al subir imagen' });
  }
});

// ----- ADMIN: limpiar órdenes pendientes expiradas y liberar sus stiker_slots -----

/**
 * Libera los stiker_slots bloqueados por órdenes 'pending' con más de `ageMinutes` minutos de antigüedad.
 * Retorna la cantidad de órdenes expiradas procesadas.
 */
async function limpiarPendientesExpirados(ageMinutes = 120) {
  const cutoff = new Date(Date.now() - ageMinutes * 60 * 1000).toISOString();
  // Contar cuántas órdenes serán afectadas antes de modificar
  const countRow = await db.prepare(
    `SELECT COUNT(*) AS n FROM orders WHERE status = 'pending' AND created_at < ?`
  ).get(cutoff);
  const n = Number(countRow?.n ?? 0);
  if (n === 0) return 0;
  // Liberar stiker_slots de esas órdenes
  await db.prepare(`
    UPDATE stiker_slots SET order_id = NULL
    WHERE order_id IN (
      SELECT id FROM orders WHERE status = 'pending' AND created_at < ?
    )
  `).run(cutoff);
  // Eliminar order_items de esas órdenes
  await db.prepare(`
    DELETE FROM order_items
    WHERE order_id IN (
      SELECT id FROM orders WHERE status = 'pending' AND created_at < ?
    )
  `).run(cutoff);
  // Marcar las órdenes como 'expired' para no perder el historial
  await db.prepare(
    `UPDATE orders SET status = 'expired' WHERE status = 'pending' AND created_at < ?`
  ).run(cutoff);
  return n;
}

app.post('/api/admin/limpiar-pendientes', async (req, res) => {
  try {
    const ageMinutes = Math.max(30, parseInt(req.query.minutes, 10) || 120);
    const n = await limpiarPendientesExpirados(ageMinutes);
    console.log(`Limpieza de pendientes: ${n} órdenes expiradas liberadas.`);
    res.json({ ok: true, expiradas: n, ageMinutes });
  } catch (err) {
    console.error('Error POST /api/admin/limpiar-pendientes:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----- ADMIN: reiniciar stiker_slots a 5000 (para tener los 10000 números) -----
app.post('/api/admin/reset-stiker-slots', async (req, res) => {
  try {
    await db.exec('DELETE FROM stiker_slots');
    await fillStikerSlots5000();
    console.log('Stiker slots reiniciados a 5000 (cada número 0000-9999 una sola vez).');
    res.json({ ok: true, total: 5000 });
  } catch (err) {
    console.error('Error reset-stiker-slots:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----- STIKERS -----

/** Devuelve si hay un premio mayor activo (programado, fecha hoy o futura). */
async function hayPremioMayorActivo() {
  return !!(await getPremioMayorActivoId());
}

/** Devuelve el id del premio mayor activo o null. Los stikers de cada campaña se asocian a este sorteo. */
async function getPremioMayorActivoId() {
  const hoy = new Date().toISOString().slice(0, 10);
  const row = await db.prepare(`
    SELECT id FROM sorteos
    WHERE tipo = 'mayor' AND estado = 'programado'
    AND (${dateCmpEq} OR ${dateCmpGt})
    LIMIT 1
  `).get(hoy, hoy);
  return row ? row.id : null;
}

app.get('/api/stikers', async (req, res) => {
  try {
    if (!(await hayPremioMayorActivo())) {
      return res.json({ stikers: [] });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 5000, 5000);
    // Un slot se considera "ocupado" solo si su orden está pagada.
    // Las órdenes pendientes/abandonadas no bloquean la vista del slot.
    const rows = await db.prepare(`
      SELECT ss.id,
             ss.numero_a AS "numeroA",
             ss.numero_b AS "numeroB",
             CASE WHEN ss.order_id IS NOT NULL AND o.status = 'paid' THEN 'ocupado' ELSE 'libre' END AS estado
      FROM stiker_slots ss
      LEFT JOIN orders o ON o.id = ss.order_id
      ORDER BY ss.id
      LIMIT ?
    `).all(limit);

    res.json(toJSONSafe({ stikers: rows }));
  } catch (err) {
    console.error('Error GET /api/stikers:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----- STIKERS POR CÉDULA (verificar compras) -----

app.get('/api/verificar-stikers', async (req, res) => {
  try {
    const cedula = (req.query.cedula || '').trim();
    if (!cedula) {
      return res.status(400).json({ error: 'Falta el parámetro cedula' });
    }

    const orders = await db.prepare(`
      SELECT id, stripe_session_id, status, total_cents, created_at
      FROM orders
      WHERE cedula = ?
      ORDER BY created_at DESC
    `).all(cedula);

    const stikers = [];
    for (const order of orders) {
      const items = await db.prepare(`
        SELECT numero_a, numero_b FROM order_items WHERE order_id = ?
      `).all(order.id);
      for (const item of items) {
        stikers.push({
          codigo: `STK-${order.id.slice(0, 8).toUpperCase()}`,
          numero1: item.numero_a,
          numero2: item.numero_b,
          pagado: order.status === 'paid'
        });
      }
    }

    res.json(toJSONSafe({ stikers }));
  } catch (err) {
    console.error('Error GET /api/verificar-stikers:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----- CHECKOUT (Wompi: reservar stikers y devolver URL de checkout) -----

app.post('/api/create-checkout-session', async (req, res) => {
  try {
    if (!(await hayPremioMayorActivo())) {
      return res.status(400).json({
        error: 'No hay sorteo activo. Las compras de stikers están cerradas.'
      });
    }

    const {
      amount,
      currency = 'usd',
      customerEmail,
      customerName,
      lineItems,
      metadata = {},
      successUrl,
      cancelUrl,
      selectedStikers = []
    } = req.body;

    if (!amount || amount <= 0 || !customerEmail || !successUrl || !cancelUrl) {
      return res.status(400).json({
        error: 'Faltan campos requeridos: amount, customerEmail, successUrl, cancelUrl'
      });
    }

    if (!wompiEnabled) {
      return res.status(503).json({
        error: 'Pagos con tarjeta en mantenimiento. Configura Wompi en server/.env (WOMPI_PUBLIC_KEY, WOMPI_INTEGRITY_SECRET, WOMPI_EVENTS_SECRET), o usa "Simular pago" para pruebas.'
      });
    }

    const orderId = randomUUID();
    const cedula = (metadata.cedula || '').trim();
    const nombre = (customerName || '').trim() || 'Cliente';
    const telefono = (metadata.telefono || '').trim();

    if (selectedStikers.length > 0) {
      const params = selectedStikers.flatMap(s => [s.numeroA, s.numeroB]);
      const placeholders = selectedStikers.map(() => '(?, ?)').join(', ');
      const slots = await db.prepare(`
        SELECT id, numero_a, numero_b, order_id
        FROM stiker_slots
        WHERE (numero_a, numero_b) IN (${placeholders})
      `).all(...params);

      const ocupados = slots.filter(s => s.order_id != null);
      if (ocupados.length > 0) {
        return res.status(409).json({
          error: 'Algunos stikers ya no están disponibles. Actualiza la página y elige de nuevo.'
        });
      }

      const sorteoMayorId = await getPremioMayorActivoId();
      const runTx = db.transaction(async (tx) => {
        await tx.prepare(`
          INSERT INTO orders (id, cedula, nombre, email, telefono, total_cents, currency, status, sorteo_mayor_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).run(orderId, cedula, nombre, customerEmail, telefono, amount, currency.toLowerCase(), sorteoMayorId);

        const insertItem = tx.prepare(`
          INSERT INTO order_items (order_id, numero_a, numero_b) VALUES (?, ?, ?)
        `);
        for (const s of selectedStikers) {
          await insertItem.run(orderId, s.numeroA, s.numeroB);
        }

        const updateSlot = tx.prepare(`
          UPDATE stiker_slots SET order_id = ? WHERE numero_a = ? AND numero_b = ?
        `);
        for (const s of selectedStikers) {
          await updateSlot.run(orderId, s.numeroA, s.numeroB);
        }
      });
      await runTx();
    } else {
      const sorteoMayorId = await getPremioMayorActivoId();
      await db.prepare(`
        INSERT INTO orders (id, cedula, nombre, email, telefono, total_cents, currency, status, sorteo_mayor_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(orderId, cedula, nombre, customerEmail, telefono, amount, currency.toLowerCase(), sorteoMayorId);
    }

    // ----- Wompi: Web Checkout (redirect) -----
    const amountInCents = Math.round(Number(amount));
    const currencyWompi = (currency || 'cop').toLowerCase() === 'cop' ? 'COP' : 'COP';
    const reference = orderId;
    const signature = wompiSignature(reference, amountInCents, currencyWompi);
    let redirectUrl = (successUrl || '').replace(/\{CHECKOUT_SESSION_ID\}/g, orderId);
    if (wompiRedirectOverride) {
      redirectUrl = wompiRedirectOverride;
    } else if (/localhost|127\.0\.0\.1/i.test(redirectUrl)) {
      redirectUrl = wompiSuccessUrlOverride
        ? wompiSuccessUrlOverride.replace(/\{CHECKOUT_SESSION_ID\}/g, orderId)
        : wompiRedirectFallback;
    }
    const params = new URLSearchParams({
      'public-key': wompiPublicKey,
      currency: currencyWompi,
      'amount-in-cents': String(amountInCents),
      reference,
      'signature:integrity': signature,
      'redirect-url': redirectUrl
    });
    if (customerEmail) params.set('customer-data:email', customerEmail);
    if (nombre) params.set('customer-data:full-name', nombre);
    const checkoutUrl = `${wompiCheckoutUrl}?${params.toString()}`;
    return res.json({ provider: 'wompi', checkoutUrl, sessionId: orderId });
  } catch (err) {
    console.error('Error creando sesión de pago:', err);
    res.status(500).json({
      error: err.message || 'Error al crear la sesión de pago'
    });
  }
});

// ----- SIMULAR PAGO (pruebas: registra orden pagada sin pasarela) -----
app.post('/api/simulate-payment', async (req, res) => {
  try {
    if (!(await hayPremioMayorActivo())) {
      return res.status(400).json({
        error: 'No hay sorteo activo. Las compras de stikers están cerradas.'
      });
    }

    const {
      amount,
      currency = 'cop',
      customerEmail,
      customerName,
      metadata = {},
      selectedStikers = []
    } = req.body;

    if (!amount || amount <= 0 || !customerEmail || !selectedStikers.length) {
      return res.status(400).json({
        error: 'Faltan campos requeridos: amount, customerEmail, selectedStikers (al menos uno).'
      });
    }

    const orderId = randomUUID();
    const cedula = (metadata.cedula || '').trim();
    const nombre = (customerName || '').trim() || 'Cliente';
    const telefono = (metadata.telefono || '').trim();

    const params = selectedStikers.flatMap(s => [s.numeroA, s.numeroB]);
    const placeholders = selectedStikers.map(() => '(?, ?)').join(', ');
    const slots = await db.prepare(`
      SELECT id, numero_a, numero_b, order_id
      FROM stiker_slots
      WHERE (numero_a, numero_b) IN (${placeholders})
    `).all(...params);

    const ocupados = slots.filter(s => s.order_id != null);
    if (ocupados.length > 0) {
      return res.status(409).json({
        error: 'Algunos stikers ya no están disponibles. Actualiza la página y elige de nuevo.'
      });
    }

    const sorteoMayorId = await getPremioMayorActivoId();
    const runTx = db.transaction(async (tx) => {
      await tx.prepare(`
        INSERT INTO orders (id, cedula, nombre, email, telefono, total_cents, currency, status, sorteo_mayor_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?)
      `).run(orderId, cedula, nombre, customerEmail, telefono, Math.round(Number(amount)), (currency || 'cop').toLowerCase(), sorteoMayorId);

      const insertItem = tx.prepare(`
        INSERT INTO order_items (order_id, numero_a, numero_b) VALUES (?, ?, ?)
      `);
      for (const s of selectedStikers) {
        await insertItem.run(orderId, s.numeroA, s.numeroB);
      }

      const updateSlot = tx.prepare(`
        UPDATE stiker_slots SET order_id = ? WHERE numero_a = ? AND numero_b = ?
      `);
      for (const s of selectedStikers) {
        await updateSlot.run(orderId, s.numeroA, s.numeroB);
      }
    });
    await runTx();
    await registrarBeneficiosAnticipados(orderId);

    res.json({ sessionId: orderId, ok: true });
  } catch (err) {
    console.error('Error simulate-payment:', err);
    res.status(500).json({ error: err.message || 'Error al simular el pago' });
  }
});

// ----- SESIÓN (detalle tras pago Wompi por orderId) -----

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.get('/api/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!UUID_REGEX.test(sessionId)) {
      return res.status(404).json({ error: 'Sesión no encontrada. Solo se admite pago con Wompi.' });
    }

    const order = await db.prepare('SELECT id, email, nombre, total_cents, currency, status FROM orders WHERE id = ?').get(sessionId);
    if (!order) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    if (order.status !== 'paid') {
      return res.status(200).json({
        id: order.id,
        status: 'pending',
        customer_email: order.email,
        amount_total: Number(order.total_cents),
        currency: order.currency,
        metadata: {}
      });
    }

    let stikersDetail = '';
    const items = await db.prepare('SELECT numero_a, numero_b FROM order_items WHERE order_id = ?').all(sessionId);
    if (items.length > 0) stikersDetail = items.map(i => `${i.numero_a} - ${i.numero_b}`).join(', ');
    return res.json({
      id: order.id,
      customer_email: order.email,
      amount_total: Number(order.total_cents),
      currency: order.currency,
      metadata: { customerName: order.nombre || '', stikersDetail }
    });
  } catch (err) {
    console.error('Error obteniendo sesión:', err);
    res.status(500).json({ error: err.message || 'Error al obtener la sesión' });
  }
});

// ----- WEBHOOK WOMPI (transaction.updated) -----

app.post('/api/webhooks/wompi', async (req, res) => {
  const body = req.body;
  if (!body || body.event !== 'transaction.updated' || !body.data?.transaction) {
    return res.sendStatus(200);
  }
  const transaction = body.data.transaction;
  if (transaction.status !== 'APPROVED') {
    return res.sendStatus(200);
  }
  const reference = transaction.reference;
  if (!reference) return res.sendStatus(200);

  if (wompiEventsSecret) {
    const checksum = req.headers['x-event-checksum'] || body.signature?.checksum;
    if (!checksum) {
      console.warn('Webhook Wompi: sin checksum');
      return res.status(400).send('Missing signature');
    }
    const props = body.signature?.properties || [];
    // Wompi: las propiedades son rutas dot-notation sobre el objeto RAÍZ del evento (body), no solo body.data
    const values = props.map((p) => {
      const parts = p.split('.');
      let v = body;
      for (const k of parts) v = v?.[k];
      return String(v ?? '');
    });
    const concat = values.join('') + String(body.timestamp || '') + wompiEventsSecret;
    const computed = createHash('sha256').update(concat).digest('hex').toUpperCase();
    if (computed !== String(checksum).toUpperCase()) {
      console.warn('Webhook Wompi: checksum inválido. Esperado:', computed, 'Recibido:', String(checksum).toUpperCase());
      return res.status(400).send('Invalid signature');
    }
  }

  try {
    const order = await db.prepare('SELECT id, status FROM orders WHERE id = ?').get(reference);
    if (!order || order.status === 'paid') return res.sendStatus(200);
    await db.prepare(`UPDATE orders SET status = 'paid', payment_reference = ?, stripe_session_id = ? WHERE id = ?`).run(transaction.id, transaction.id, reference);
    await registrarBeneficiosAnticipados(reference);
    console.log('Wompi: orden marcada como pagada:', reference);
  } catch (e) {
    console.error('Webhook Wompi:', e?.message || e);
    return res.status(500).send('Error');
  }
  res.sendStatus(200);
});

// ----- ADMIN (opcional) -----

app.get('/api/admin/orders', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const rows = await db.prepare(`
      SELECT o.id, o.cedula, o.nombre, o.email, o.total_cents, o.currency, o.status, o.created_at,
             (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as items_count
      FROM orders o
      ORDER BY o.created_at DESC
      LIMIT ?
    `).all(limit);
    res.json(toJSONSafe({ orders: rows }));
  } catch (err) {
    console.error('Error GET /api/admin/orders:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/orders/:id/confirm-cash', async (req, res) => {
  try {
    const id = req.params.id;
    const order = await db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    if (order.status === 'paid') {
      return res.status(400).json({ error: 'La orden ya está marcada como pagada' });
    }

    await db.prepare(`UPDATE orders SET status = 'paid' WHERE id = ?`).run(id);
    await registrarBeneficiosAnticipados(id);

    const updated = await db.prepare(`
      SELECT o.id, o.cedula, o.nombre, o.email, o.total_cents, o.currency, o.status, o.created_at,
             (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as items_count
      FROM orders o
      WHERE o.id = ?
    `).get(id);

    res.json(toJSONSafe(updated));
  } catch (err) {
    console.error('Error POST /api/admin/orders/:id/confirm-cash:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const totalOrders = await db.prepare("SELECT COUNT(*) as n FROM orders WHERE status = 'paid'").get();
    const totalStikersSold = await db.prepare(`
      SELECT COUNT(*) as n
      FROM stiker_slots ss
      JOIN orders o ON o.id = ss.order_id AND o.status = 'paid'
    `).get();
    const totalStikers = await db.prepare('SELECT COUNT(*) as n FROM stiker_slots').get();
    const totalRevenue = await db.prepare("SELECT COALESCE(SUM(total_cents), 0) as n FROM orders WHERE status = 'paid'").get();
    res.json(toJSONSafe({
      totalOrders: Number(totalOrders?.n ?? 0),
      totalStikersSold: Number(totalStikersSold?.n ?? 0),
      totalStikers: Number(totalStikers?.n ?? 0),
      totalRevenueCents: Number(totalRevenue?.n ?? 0)
    }));
  } catch (err) {
    console.error('Error GET /api/admin/stats:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/beneficios', async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT b.id, b.sorteo_id, s.nombre as sorteo_nombre, b.order_id,
             b.numero_a, b.numero_b, b.cedula, b.nombre, b.email, b.telefono, b.created_at
      FROM beneficios_anticipados b
      LEFT JOIN sorteos s ON s.id = b.sorteo_id
      ORDER BY b.created_at DESC
      LIMIT 100
    `).all();
    res.json(toJSONSafe({ beneficios: rows }));
  } catch (err) {
    console.error('Error GET /api/admin/beneficios:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Vuelve a revisar todas las órdenes pagadas y registra beneficios anticipados que no se hubieran detectado antes. */
app.post('/api/admin/revisar-beneficios', async (req, res) => {
  try {
    const orders = await db.prepare('SELECT id FROM orders WHERE status = ?').all('paid');
    let count = 0;
    for (const row of orders) {
      const before = await db.prepare('SELECT COUNT(*) as n FROM beneficios_anticipados WHERE order_id = ?').get(row.id);
      await registrarBeneficiosAnticipados(row.id);
      const after = await db.prepare('SELECT COUNT(*) as n FROM beneficios_anticipados WHERE order_id = ?').get(row.id);
      if (after.n > before.n) count++;
    }
    console.log('Revisión de beneficios: órdenes pagadas revisadas, nuevas coincidencias:', count);
    res.json({ ok: true, ordenesRevisadas: orders.length, nuevasCoincidencias: count });
  } catch (err) {
    console.error('Error POST /api/admin/revisar-beneficios:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----- CONFIG (público: precio stiker para la tienda) -----

app.get('/api/config', async (req, res) => {
  try {
    const precio = await db.prepare("SELECT value FROM config WHERE key = 'precio_stiker_cents'").get();
    const currency = await db.prepare("SELECT value FROM config WHERE key = 'currency'").get();
    res.json({
      precioStikerCents: precio ? parseInt(precio.value, 10) : 5000,
      currency: currency ? currency.value : 'cop'
    });
  } catch (err) {
    console.error('Error GET /api/config:', err);
    res.json({ precioStikerCents: 5000, currency: 'cop' });
  }
});

// ----- ADMIN CONFIG -----

app.get('/api/admin/config', async (req, res) => {
  try {
    const rows = await db.prepare('SELECT key, value FROM config').all();
    const config = {};
    for (const r of rows) config[r.key] = r.value;
    res.json(config);
  } catch (err) {
    console.error('Error GET /api/admin/config:', err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/config', async (req, res) => {
  try {
    const { precioStikerCents, currency } = req.body;
    if (precioStikerCents !== undefined) {
      const cents = Math.round(Number(precioStikerCents));
      if (cents < 0) return res.status(400).json({ error: 'Precio debe ser >= 0' });
      await db.prepare("INSERT INTO config (key, value) VALUES ('precio_stiker_cents', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(cents));
    }
    if (currency !== undefined && typeof currency === 'string') {
      const val = currency.trim().toLowerCase();
      await db.prepare("INSERT INTO config (key, value) VALUES ('currency', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(val);
    }
    const rows = await db.prepare('SELECT key, value FROM config').all();
    const config = {};
    for (const r of rows) config[r.key] = r.value;
    res.json(config);
  } catch (err) {
    console.error('Error PATCH /api/admin/config:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----- SORTEOS (público y admin) -----

const sorteosSelect = 'id, nombre, fecha, descripcion, tipo, estado, premio_descripcion, imagen_url, sorteo_mayor_id, numero_ganador_a, numero_ganador_b, numeros_beneficiados, created_at';

app.get('/api/sorteos', async (req, res) => {
  try {
    const estado = req.query.estado;
    let sql = `SELECT ${sorteosSelect} FROM sorteos ORDER BY fecha ASC`;
    const params = [];
    if (estado) {
      sql = `SELECT ${sorteosSelect} FROM sorteos WHERE estado = ? ORDER BY fecha ASC`;
      params.push(estado);
    }
    const rows = await db.prepare(sql).all(...params);
    res.json(toJSONSafe({ sorteos: rows }));
  } catch (err) {
    console.error('Error GET /api/sorteos:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sorteos/home', async (req, res) => {
  try {
    const hoy = new Date().toISOString().slice(0, 10);

    const principal = await db.prepare(`
      SELECT ${sorteosSelect}
      FROM sorteos
      WHERE tipo = 'mayor' AND estado = 'programado'
      AND (${dateCmpEq} OR ${dateCmpGt})
      ORDER BY fecha ASC
      LIMIT 1
    `).get(hoy, hoy);

    let anticipadosActuales = [];
    if (principal) {
      const rows = await db.prepare(`
        SELECT s.id, s.nombre, s.fecha, s.premio_descripcion, s.numeros_beneficiados
        FROM sorteos s
        WHERE s.sorteo_mayor_id = ? AND s.estado = 'programado'
        ORDER BY s.id ASC
      `).all(principal.id);
      const sorteoIds = rows.map(r => r.id);
      let beneficiosMap = {};
      if (sorteoIds.length > 0) {
        const placeholders = sorteoIds.map(() => '?').join(',');
        const beneficios = await db.prepare(`
          SELECT DISTINCT ON (sorteo_id) sorteo_id, numero_a, numero_b
          FROM beneficios_anticipados
          WHERE sorteo_id IN (${placeholders})
          ORDER BY sorteo_id, id ASC
        `).all(...sorteoIds);
        for (const b of beneficios) beneficiosMap[b.sorteo_id] = b;
      }
      anticipadosActuales = rows.map(row => {
        const benef = beneficiosMap[row.id];
        return {
          ...row,
          revelado: !!benef,
          numero_revelado: benef ? `${benef.numero_a}-${benef.numero_b}` : null
        };
      });
    }

    const mayoresRealizados = await db.prepare(`
      SELECT ${sorteosSelect}, ganador_nombre, ganador_cedula, ganador_email, ganador_telefono
      FROM sorteos
      WHERE tipo = 'mayor' AND estado = 'realizado'
      ORDER BY fecha DESC
      LIMIT 6
    `).all();

    res.json(toJSONSafe({
      principal: principal || null,
      anticipadosActuales,
      mayoresRealizados
    }));
  } catch (err) {
    console.error('Error GET /api/sorteos/home:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sorteos/:id', async (req, res) => {
  try {
    const row = await db.prepare(`SELECT ${sorteosSelect} FROM sorteos WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Sorteo no encontrado' });
    res.json(toJSONSafe(row));
  } catch (err) {
    console.error('Error GET /api/sorteos/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

function randomNumero4() {
  return Math.floor(Math.random() * 10000).toString().padStart(4, '0');
}

/** Shuffle Fisher-Yates. */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Inserta 5000 stiker_slots: cada número 0000-9999 aparece exactamente una vez; en cada par los dos números son distintos. */
async function fillStikerSlots5000(txOrDb = db) {
  const nums = Array.from({ length: 10000 }, (_, i) => i.toString().padStart(4, '0'));
  shuffleArray(nums);
  const rows = Array.from({ length: 5000 }, (_, i) => [nums[2 * i], nums[2 * i + 1]]);
  if (typeof txOrDb.runBatch === 'function') {
    await txOrDb.runBatch('INSERT INTO stiker_slots (numero_a, numero_b) VALUES (?, ?)', rows);
    return;
  }
  const insertSlot = txOrDb.prepare('INSERT INTO stiker_slots (numero_a, numero_b) VALUES (?, ?)');
  for (let i = 0; i < 5000; i++) {
    await insertSlot.run(rows[i][0], rows[i][1]);
  }
}

/** Registra beneficios anticipados cuando una orden queda pagada. Solo coincide con números bendecidos de anticipados de la misma campaña (mismo premio mayor). Sin duplicados. */
async function registrarBeneficiosAnticipados(orderId) {
  const order = await db.prepare('SELECT cedula, nombre, email, telefono, sorteo_mayor_id FROM orders WHERE id = ? AND status = ?').get(orderId, 'paid');
  if (!order) return;
  const items = await db.prepare('SELECT numero_a, numero_b FROM order_items WHERE order_id = ?').all(orderId);
  if (items.length === 0) return;

  const toKey = (a, b) => `${pad4(a)}-${pad4(b)}`;
  const selectedKeys = items.map((i) => ({
    key: toKey(i.numero_a, i.numero_b),
    keyReverse: toKey(i.numero_b, i.numero_a),
    numeroA: pad4(i.numero_a),
    numeroB: pad4(i.numero_b)
  }));

  // Solo anticipados de la misma campaña (mismo premio mayor) que la orden
  const sorteosBenef = order.sorteo_mayor_id
    ? await db.prepare(`
        SELECT id, numeros_beneficiados FROM sorteos
        WHERE tipo = 'anticipado' AND estado = 'programado' AND sorteo_mayor_id = ?
        AND numeros_beneficiados IS NOT NULL AND TRIM(CAST(numeros_beneficiados AS TEXT)) <> ''
      `).all(order.sorteo_mayor_id)
    : await db.prepare(`
        SELECT id, numeros_beneficiados FROM sorteos
        WHERE tipo = 'anticipado' AND estado = 'programado' AND numeros_beneficiados IS NOT NULL AND TRIM(CAST(numeros_beneficiados AS TEXT)) <> ''
      `).all();

  const insertBenef = db.prepare(`
    INSERT INTO beneficios_anticipados (sorteo_id, order_id, numero_a, numero_b, cedula, nombre, email, telefono)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const existsBenefEnSorteo = db.prepare(`
    SELECT 1 FROM beneficios_anticipados
    WHERE sorteo_id = ? AND (TRIM(CAST(numero_a AS TEXT)) = ? AND TRIM(CAST(numero_b AS TEXT)) = ?) LIMIT 1
  `);
  // Un stiker solo puede ganar un anticipado: si ya ganó algún bendecido de esta campaña, no se asigna a otro
  const stickerYaGanoAnticipadoEnCampanha = order.sorteo_mayor_id
    ? db.prepare(`
        SELECT 1 FROM beneficios_anticipados b
        JOIN sorteos s ON s.id = b.sorteo_id
        WHERE b.order_id = ? AND TRIM(CAST(b.numero_a AS TEXT)) = ? AND TRIM(CAST(b.numero_b AS TEXT)) = ?
        AND s.sorteo_mayor_id = ? LIMIT 1
      `)
    : db.prepare(`
        SELECT 1 FROM beneficios_anticipados b
        WHERE b.order_id = ? AND TRIM(CAST(b.numero_a AS TEXT)) = ? AND TRIM(CAST(b.numero_b AS TEXT)) = ? LIMIT 1
      `);

  for (const srt of sorteosBenef) {
    const text = (srt.numeros_beneficiados || '').toString().trim();
    const tokens = text.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
    const set = new Set();
    const numerosSueltos = new Set();
    for (const tok of tokens) {
      const cleaned = tok.replace(/\s+/g, '');
      const soloDigitos = cleaned.replace(/\D/g, '');
      let parts = cleaned.split(/[-:]/).map((p) => pad4(p)).filter((p) => p.length === 4);
      if (parts.length === 1 && soloDigitos.length >= 8) {
        parts = [pad4(soloDigitos.slice(0, 4)), pad4(soloDigitos.slice(-4))];
      }
      if (parts.length === 2) {
        set.add(`${parts[0]}-${parts[1]}`);
        set.add(`${parts[1]}-${parts[0]}`);
        numerosSueltos.add(parts[0]);
        numerosSueltos.add(parts[1]);
      } else if (parts.length === 1) {
        numerosSueltos.add(parts[0]);
      } else if (soloDigitos.length === 4) {
        numerosSueltos.add(pad4(soloDigitos));
      }
    }
    if (set.size === 0 && numerosSueltos.size === 0) continue;
    for (const s of selectedKeys) {
      const matchPar = set.has(s.key) || set.has(s.keyReverse);
      const matchNumero = numerosSueltos.has(s.numeroA) || numerosSueltos.has(s.numeroB);
      const matches = matchPar || matchNumero;
      const yaEnEsteSorteo = await existsBenefEnSorteo.get(srt.id, s.numeroA, s.numeroB);
      const yaGanoOtroAnticipado = order.sorteo_mayor_id
        ? await stickerYaGanoAnticipadoEnCampanha.get(orderId, s.numeroA, s.numeroB, order.sorteo_mayor_id)
        : await stickerYaGanoAnticipadoEnCampanha.get(orderId, s.numeroA, s.numeroB);
      if (matches && !yaEnEsteSorteo && !yaGanoOtroAnticipado) {
        await insertBenef.run(srt.id, orderId, s.numeroA, s.numeroB, order.cedula || null, order.nombre || null, order.email || null, order.telefono || null);
      }
    }
  }
}

app.post('/api/admin/sorteos', async (req, res) => {
  try {
    const { nombre, fecha, descripcion, tipo = 'anticipado', premio_descripcion, imagen_url, numeros_beneficiados } = req.body;
    if (!nombre || !fecha) {
      return res.status(400).json({ error: 'Faltan nombre o fecha' });
    }
    if (tipo === 'mayor' && !(imagen_url && String(imagen_url).trim())) {
      return res.status(400).json({ error: 'Para Premio Mayor es obligatoria la URL de la imagen del premio (para el hero).' });
    }

    const runTx = db.transaction(async (tx) => {
      const result = await tx.prepare(`
        INSERT INTO sorteos (nombre, fecha, descripcion, tipo, estado, premio_descripcion, imagen_url, sorteo_mayor_id, numeros_beneficiados)
        VALUES (?, ?, ?, ?, 'programado', ?, ?, NULL, ?)
      `).run(
        nombre,
        fecha,
        descripcion || '',
        tipo,
        premio_descripcion || null,
        (tipo === 'mayor' ? String(imagen_url).trim() : null) || null,
        (tipo !== 'mayor' && numeros_beneficiados) ? String(numeros_beneficiados).trim() || null : null
      );
      const mayorId = result.lastInsertRowid;
      if (!mayorId) throw new Error('No se obtuvo el id del sorteo creado');
      const row = await tx.prepare('SELECT * FROM sorteos WHERE id = ?').get(mayorId);
      if (!row) throw new Error('Sorteo creado pero no se pudo leer (id ' + mayorId + ')');

      if (tipo === 'mayor') {
        await tx.exec('DELETE FROM beneficios_anticipados;');
        await tx.exec('DELETE FROM order_items;');
        await tx.prepare('UPDATE stiker_slots SET order_id = NULL').run();
        await tx.exec('DELETE FROM orders;');
        await tx.exec('DELETE FROM stiker_slots;');
        await fillStikerSlots5000(tx);

        const premioAnticipado = row.premio_descripcion && String(row.premio_descripcion).trim()
          ? String(row.premio_descripcion).trim()
          : '$500.000 COP';
        const insertAnticipado = tx.prepare(`
          INSERT INTO sorteos (nombre, fecha, descripcion, tipo, estado, premio_descripcion, sorteo_mayor_id, numeros_beneficiados)
          VALUES (?, ?, ?, 'anticipado', 'programado', ?, ?, ?)
        `);
        const seen = new Set();
        for (let i = 1; i <= 10; i++) {
          let num = randomNumero4();
          while (seen.has(num)) num = randomNumero4();
          seen.add(num);
          await insertAnticipado.run(`Anticipado ${i}`, fecha, '', premioAnticipado, mayorId, num);
        }
      }
      return row;
    });
    const row = await runTx();
    res.status(201).json(toJSONSafe(row));
  } catch (err) {
    console.error('Error POST /api/admin/sorteos:', err);
    const msg = (err && (err.message || err.code || err.error || (typeof err === 'string' ? err : undefined))) || 'Error al crear el sorteo';
    if (!res.headersSent) res.status(500).json({ error: String(msg) });
  }
});

app.patch('/api/admin/sorteos/:id', async (req, res) => {
  try {
    const { nombre, fecha, descripcion, tipo, estado, premio_descripcion, imagen_url, numeros_beneficiados } = req.body;
    const id = req.params.id;
    const current = await db.prepare('SELECT * FROM sorteos WHERE id = ?').get(id);
    if (!current) return res.status(404).json({ error: 'Sorteo no encontrado' });

    const updates = [];
    const params = [];
    if (nombre !== undefined) { updates.push('nombre = ?'); params.push(nombre); }
    if (fecha !== undefined) { updates.push('fecha = ?'); params.push(fecha); }
    if (descripcion !== undefined) { updates.push('descripcion = ?'); params.push(descripcion); }
    if (tipo !== undefined) { updates.push('tipo = ?'); params.push(tipo); }
    if (estado !== undefined) { updates.push('estado = ?'); params.push(estado); }
    if (premio_descripcion !== undefined) { updates.push('premio_descripcion = ?'); params.push(premio_descripcion); }
    if (imagen_url !== undefined) { updates.push('imagen_url = ?'); params.push(imagen_url); }
    if (numeros_beneficiados !== undefined) { updates.push('numeros_beneficiados = ?'); params.push((numeros_beneficiados || '').trim() || null); }
    if (updates.length === 0) return res.json(toJSONSafe(current));

    params.push(id);
    await db.prepare(`UPDATE sorteos SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const row = await db.prepare('SELECT * FROM sorteos WHERE id = ?').get(id);
    res.json(toJSONSafe(row));
  } catch (err) {
    console.error('Error PATCH /api/admin/sorteos/:id:', err);
    const msg = (err && (err.message || err.error || (typeof err === 'string' ? err : undefined))) || 'Error al actualizar el sorteo';
    if (!res.headersSent) res.status(500).json({ error: String(msg) });
  }
});

app.delete('/api/admin/sorteos/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const current = await db.prepare('SELECT * FROM sorteos WHERE id = ?').get(id);
    if (!current) return res.status(404).json({ error: 'Sorteo no encontrado' });

    if (current.estado === 'realizado') {
      return res.status(400).json({ error: 'No se puede eliminar un sorteo ya realizado.' });
    }

    if ((current.tipo || '').toLowerCase() === 'mayor') {
      const ordenes = await db.prepare('SELECT COUNT(*) AS n FROM orders WHERE sorteo_mayor_id = ?').get(id);
      if (Number(ordenes?.n || 0) > 0) {
        return res.status(400).json({ error: 'No se puede eliminar un Premio Mayor que ya tiene ventas asociadas.' });
      }

      // Borrar anticipados de la campaña y luego el premio mayor
      await db.prepare('DELETE FROM sorteos WHERE sorteo_mayor_id = ?').run(id);
      await db.prepare('DELETE FROM sorteos WHERE id = ?').run(id);
      return res.json({ ok: true });
    }

    const usadosComoBenef = await db.prepare('SELECT COUNT(*) AS n FROM beneficios_anticipados WHERE sorteo_id = ?').get(id);
    if (Number(usadosComoBenef?.n || 0) > 0) {
      return res.status(400).json({ error: 'Este sorteo tiene beneficios registrados y no se puede eliminar.' });
    }

    await db.prepare('DELETE FROM sorteos WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error DELETE /api/admin/sorteos/:id:', err);
    const msg = (err && (err.message || err.error || (typeof err === 'string' ? err : undefined))) || 'Error al eliminar el sorteo';
    if (!res.headersSent) res.status(500).json({ error: String(msg) });
  }
});

function pad4(s) {
  const n = String(s ?? '').replace(/\D/g, '');
  if (n.length === 0) return '';
  return n.length <= 4 ? n.padStart(4, '0') : n.slice(-4);
}

/** Busca el cliente (orden pagada) que tiene un stiker con numero_a-numero_b exacto. Devuelve { ganador, numero_a, numero_b } o null. */
async function buscarGanadorPorPar(numero_a, numero_b) {
  const a = pad4(numero_a);
  const b = pad4(numero_b);
  const item = await db.prepare(`
    SELECT oi.numero_a, oi.numero_b, oi.order_id
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status = 'paid' AND oi.numero_a = ? AND oi.numero_b = ?
    LIMIT 1
  `).get(a, b);
  if (!item) return null;
  const datosCliente = await db.prepare('SELECT id, cedula, nombre, email, telefono FROM orders WHERE id = ?').get(item.order_id);
  const numerosCliente = await db.prepare('SELECT numero_a, numero_b FROM order_items WHERE order_id = ?').all(item.order_id);
  if (!datosCliente) return null;
  return {
    ganador: {
      order_id: datosCliente.id,
      cedula: datosCliente.cedula,
      nombre: datosCliente.nombre,
      email: datosCliente.email,
      telefono: datosCliente.telefono,
      numeros: numerosCliente
    },
    numero_a: item.numero_a,
    numero_b: item.numero_b
  };
}

/** Busca el cliente que tiene un stiker vendido (orden pagada) donde uno de los dos números coincide con el de 4 cifras. */
async function buscarGanadorPorNumeroUnico(numero) {
  const n = pad4(numero);
  if (!n || n.length !== 4) return null;
  const item = await db.prepare(`
    SELECT oi.numero_a, oi.numero_b, oi.order_id
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status = 'paid'
    AND (TRIM(CAST(oi.numero_a AS TEXT)) = ? OR TRIM(CAST(oi.numero_b AS TEXT)) = ?)
    LIMIT 1
  `).get(n, n);
  if (!item) return null;
  const datosCliente = await db.prepare('SELECT id, cedula, nombre, email, telefono FROM orders WHERE id = ?').get(item.order_id);
  const numerosCliente = await db.prepare('SELECT numero_a, numero_b FROM order_items WHERE order_id = ?').all(item.order_id);
  if (!datosCliente) return null;
  return {
    ganador: {
      order_id: datosCliente.id,
      cedula: datosCliente.cedula,
      nombre: datosCliente.nombre,
      email: datosCliente.email,
      telefono: datosCliente.telefono,
      numeros: numerosCliente
    },
    numero_a: String(item.numero_a ?? '').trim(),
    numero_b: String(item.numero_b ?? '').trim()
  };
}

/** Indica si existe algún order_item (pagado o no) con ese número de 4 cifras. Para mensajes de error. */
async function existeStikerConNumero(numero) {
  const n = pad4(numero);
  if (!n || n.length !== 4) return { existe: false, pagado: false };
  const paid = await db.prepare(`
    SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status = 'paid' AND (TRIM(CAST(oi.numero_a AS TEXT)) = ? OR TRIM(CAST(oi.numero_b AS TEXT)) = ?)
    LIMIT 1
  `).get(n, n);
  if (paid) return { existe: true, pagado: true };
  const pending = await db.prepare(`
    SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status = 'pending' AND (TRIM(CAST(oi.numero_a AS TEXT)) = ? OR TRIM(CAST(oi.numero_b AS TEXT)) = ?)
    LIMIT 1
  `).get(n, n);
  return { existe: !!pending, pagado: false };
}

app.get('/api/admin/sorteos/:id/consultar-ganador', async (req, res) => {
  try {
    const id = req.params.id;
    const numero = (req.query.numero || req.query.numero_ganador || '').trim().replace(/\D/g, '');
    if (!numero || numero.length === 0) {
      return res.status(400).json({ error: 'Indica el número ganador de 4 cifras (query: numero=1234)' });
    }
    const sorteo = await db.prepare('SELECT * FROM sorteos WHERE id = ?').get(id);
    if (!sorteo) return res.status(404).json({ error: 'Sorteo no encontrado' });
    const resultado = await buscarGanadorPorNumeroUnico(numero);
    const ganador = resultado ? resultado.ganador : null;
    const { existe, pagado } = await existeStikerConNumero(numero);
    res.json({
      ganador,
      stiker_ganador: resultado ? `${resultado.numero_a}-${resultado.numero_b}` : null,
      sorteo: { id: sorteo.id, nombre: sorteo.nombre, fecha: sorteo.fecha },
      existe_sin_pagar: existe && !pagado
    });
  } catch (err) {
    console.error('Error GET /api/admin/sorteos/:id/consultar-ganador:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/sorteos/:id/realizar', async (req, res) => {
  try {
    const id = req.params.id;
    const sorteo = await db.prepare('SELECT * FROM sorteos WHERE id = ?').get(id);
    if (!sorteo) return res.status(404).json({ error: 'Sorteo no encontrado' });
    if (sorteo.estado === 'realizado') {
      return res.status(400).json({ error: 'Este sorteo ya fue realizado' });
    }

    const numero_ganador = String(req.body.numero_ganador || '').trim().replace(/\D/g, '');
    if (!numero_ganador || numero_ganador.length === 0) {
      return res.status(400).json({
        code: 'numero_requerido',
        error: 'Debes indicar el número ganador de la lotería local (4 cifras, ej. 1234).'
      });
    }

    const resultado = await buscarGanadorPorNumeroUnico(numero_ganador);
    if (!resultado) {
      const { existe, pagado } = await existeStikerConNumero(numero_ganador);
      const error = existe && !pagado
        ? 'Hay una venta con ese número pero la orden no está marcada como pagada. Confirma el pago en Wompi o espera el webhook.'
        : 'No hay ningún comprador con ese número. Extiende la fecha del sorteo para dar más posibilidades de ganar.';
      return res.status(400).json({ code: 'no_ganador', error });
    }
    const { ganador, numero_a: na, numero_b: nb } = resultado;

    await db.prepare(`
      UPDATE sorteos
      SET estado = 'realizado',
          numero_ganador_a = ?,
          numero_ganador_b = ?,
          ganador_nombre = ?,
          ganador_cedula = ?,
          ganador_email = ?,
          ganador_telefono = ?
      WHERE id = ?
    `).run(
      na,
      nb,
      ganador.nombre,
      ganador.cedula,
      ganador.email,
      ganador.telefono,
      id
    );

    if (sorteo.tipo === 'mayor') {
      await db.prepare(`UPDATE sorteos SET estado = 'realizado' WHERE sorteo_mayor_id = ?`).run(id);
      await db.exec('DELETE FROM beneficios_anticipados;');
      await db.exec('DELETE FROM order_items;');
      // Primero liberar los stiker_slots para no violar la FK stiker_slots.order_id -> orders.id
      await db.exec('DELETE FROM stiker_slots;');
      await db.exec('DELETE FROM orders;');
      await fillStikerSlots5000();
      console.log('Nueva campaña: ventas, stikers y anticipados reiniciados después del Premio Mayor.');
    }

    const updated = await db.prepare('SELECT * FROM sorteos WHERE id = ?').get(id);
    res.json(toJSONSafe({ sorteo: updated, ganador: resultado.ganador }));
  } catch (err) {
    console.error('Error POST /api/admin/sorteos/:id/realizar:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----- PROGRESO (público) -----

app.get('/api/progreso', async (req, res) => {
  try {
    // Solo contar stikers cuya orden esté efectivamente pagada (evita inflar el progreso con checkouts abandonados)
    const totalStikersSold = await db.prepare(`
      SELECT COUNT(*) as n
      FROM stiker_slots ss
      JOIN orders o ON o.id = ss.order_id AND o.status = 'paid'
    `).get();
    const totalStikers = await db.prepare('SELECT COUNT(*) as n FROM stiker_slots').get();
    res.json(toJSONSafe({
      totalStikersSold: Number(totalStikersSold?.n ?? 0),
      totalStikers: Number(totalStikers?.n ?? 0)
    }));
  } catch (err) {
    console.error('Error GET /api/progreso:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Servidor en http://localhost:${port}`);
  if (!wompiEnabled) {
    console.warn('⚠️  Wompi no configurado. Define WOMPI_PUBLIC_KEY y WOMPI_INTEGRITY_SECRET en server/.env para pagos con tarjeta, o usa "Simular pago".');
  } else {
    console.log('💳 Wompi activo' + (wompiPublicKey.startsWith('pub_test_') ? ' (sandbox)' : ' (producción)'));
  }
  if (!adminPassword) {
    console.warn('⚠️  ADMIN_PASSWORD no definida. El panel /admin no permitirá login.');
  }
  setTimeout(scheduleCleanup, 5000);
});

export default app;
