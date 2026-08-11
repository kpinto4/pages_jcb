import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import fs from 'fs';
import { initDb } from './db-adapter.js';
import { randomUUID, createHash } from 'crypto';

let enviarComprobanteTrasPago = async () => {};
let verificarSmtp = async () => ({ configured: false, ok: false, error: 'Módulo de correo no cargado' });
let estadoSmtp = () => ({ configured: false, ok: false, error: 'Módulo de correo no cargado' });
try {
  const emailModule = await import('./email.js');
  const { enviarComprobante } = emailModule;
  verificarSmtp = emailModule.verificarSmtp;
  estadoSmtp = emailModule.estadoSmtp;
  enviarComprobanteTrasPago = async (orderId) => {
    const order = await db?.prepare('SELECT email, nombre, total_cents, currency FROM orders WHERE id = ? AND status = ?').get(orderId, 'paid');
    if (!order?.email) return;
    const items = await db?.prepare('SELECT numero_a, numero_b FROM order_items WHERE order_id = ?').all(orderId) || [];
    return enviarComprobante(order, items);
  };
} catch (e) {
  console.warn('Email (comprobantes) no disponible:', e.message);
}

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
/** Órdenes `pending` sin pago: liberar stikers tras este tiempo (min). Rango 5–30; por defecto 30. */
const pendingOrderExpireMinutes = Math.min(30, Math.max(5, Number.parseInt(process.env.PENDING_ORDER_EXPIRE_MINUTES ?? '30', 10) || 30));
/** Máximo de stikers por compra (evita saturación). Rango 1–100; por defecto 50. */
const maxStickersPerOrder = Math.min(100, Math.max(1, Number.parseInt(process.env.MAX_STICKERS_PER_ORDER ?? '50', 10) || 50));

/** Fecha calendario en Colombia (YYYY-MM-DD) para sorteos activos. */
function fechaHoyColombia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

/** Rate limit en memoria por clave (IP + ruta). */
function createRateLimiter({ windowMs, max, keyPrefix }) {
  const hits = new Map();
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    let bucket = hits.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      hits.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({
        error: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.'
      });
    }
    next();
  };
}

const loginRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'login' });
const verificarRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40, keyPrefix: 'verificar' });
/** Intervalo de la tarea de limpieza: a lo sumo la mitad del tiempo de expiración, entre 5 y 15 min. */
const pendingCleanupIntervalMs = Math.max(
  5 * 60 * 1000,
  Math.min(15 * 60 * 1000, Math.floor(pendingOrderExpireMinutes / 2) * 60 * 1000)
);
// Auto-limpieza de órdenes pendientes expiradas al arrancar y luego cada pendingCleanupIntervalMs
async function scheduleCleanup() {
  if (!db) return;
  try {
    const n = await limpiarPendientesExpirados(pendingOrderExpireMinutes);
    if (n > 0) console.log(`Auto-limpieza pendientes: ${n} órdenes expiradas (>${pendingOrderExpireMinutes} min).`);
  } catch (e) {
    console.warn('Auto-limpieza pendientes:', e.message);
  }
  setTimeout(scheduleCleanup, pendingCleanupIntervalMs);
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
const isProduction = process.env.NODE_ENV === 'production';
/** “Simular pago” solo con servidor en desarrollo; producción debe usar Wompi (sandbox pub_test_* o llaves de producción). */
const simulatePaymentAllowed = !isProduction;

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
    simulatePayment: simulatePaymentAllowed,
    nodeEnv: process.env.NODE_ENV || 'development',
    adminConfigured: !!process.env.ADMIN_PASSWORD,
    hasDatabase: !!process.env.DATABASE_URL,
    dbConnected: !!db,
    dbError: dbInitError || undefined
  });
});

// ----- ADMIN LOGIN (público, antes del middleware) -----

app.post('/api/admin/login', loginRateLimit, (req, res) => {
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

// ----- ADMIN: diagnóstico en vivo (DB, Wompi, SMTP, CORS) sin reiniciar el servidor -----
app.get('/api/admin/diagnostico', async (req, res) => {
  let dbOk = false;
  let dbError = dbInitError || null;
  try {
    if (db) {
      await db.get('SELECT 1');
      dbOk = true;
    }
  } catch (e) {
    dbOk = false;
    dbError = e?.message || String(e);
  }

  const smtp = await verificarSmtp();

  res.json({
    checkedAt: new Date().toISOString(),
    db: { ok: dbOk, hasDatabaseUrl: !!process.env.DATABASE_URL, error: dbError || undefined },
    wompi: {
      ok: wompiEnabled,
      mode: wompiEnabled ? (wompiPublicKey.startsWith('pub_test_') ? 'sandbox' : 'produccion') : undefined,
      error: wompiEnabled ? undefined : 'Faltan WOMPI_PUBLIC_KEY o WOMPI_INTEGRITY_SECRET'
    },
    smtp: {
      ok: !!smtp.ok,
      configured: smtp.configured,
      host: smtp.host,
      port: smtp.port,
      user: smtp.user,
      secure: smtp.secure,
      error: smtp.ok ? undefined : smtp.error
    },
    admin: {
      ok: !!adminPassword,
      error: adminPassword ? undefined : 'ADMIN_PASSWORD no definida'
    },
    cors: {
      allowedOrigin: process.env.ALLOWED_ORIGIN || null,
      note: process.env.ALLOWED_ORIGIN
        ? undefined
        : 'Sin ALLOWED_ORIGIN definido: se acepta cualquier origen (solo recomendable en desarrollo).'
    },
    publicApiUrl: publicApiUrl || null
  });
});

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
async function limpiarPendientesExpirados(ageMinutes = pendingOrderExpireMinutes) {
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
    const q = parseInt(req.query.minutes, 10);
    const ageMinutes = Number.isFinite(q)
      ? Math.min(30, Math.max(5, q))
      : pendingOrderExpireMinutes;
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
  const hoy = fechaHoyColombia();
  const row = await db.prepare(`
    SELECT id FROM sorteos
    WHERE tipo = 'mayor' AND estado = 'programado'
    AND (${dateCmpEq} OR ${dateCmpGt})
    LIMIT 1
  `).get(hoy, hoy);
  return row ? row.id : null;
}

/** Precio por stiker en centavos (desde config). */
async function getPrecioStikerCents() {
  const precio = await db.prepare("SELECT value FROM config WHERE key = 'precio_stiker_cents'").get();
  const n = precio ? parseInt(precio.value, 10) : 5000;
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

/** % de stikers vendidos (solo órdenes pagadas). */
async function getPctStikersVendidos() {
  const totalStikersSoldRow = await db.prepare(`
    SELECT COUNT(*) as n
    FROM stiker_slots ss
    JOIN orders o ON o.id = ss.order_id AND o.status = 'paid'
  `).get();
  const totalStikersRow = await db.prepare('SELECT COUNT(*) as n FROM stiker_slots').get();
  const totalSold = Number(totalStikersSoldRow?.n ?? 0);
  const totalSlots = Number(totalStikersRow?.n ?? 0);
  if (totalSlots <= 0) return 0;
  return (totalSold / totalSlots) * 100;
}

/**
 * Umbrales % vendido (10 filas en admin: 10%, 20%, …).
 * Cada umbral cumplido suma 1 cupo de premio anticipado en la campaña (máx. 10).
 */
async function getAnticipadosPercentThresholds() {
  const cfg = await db.prepare("SELECT value FROM config WHERE key = 'anticipados_percent'").get();
  if (cfg?.value) {
    const raw = cfg.value.split(',').map((p) => parseInt(String(p).trim(), 10));
    const arr = raw
      .filter((n) => !isNaN(n) && n > 0 && n <= 100)
      .slice(0, 10);
    while (arr.length < 10) arr.push(100);
    return arr;
  }
  const stepCfg = await db.prepare("SELECT value FROM config WHERE key = 'anticipado_step_percent'").get();
  const step = stepCfg ? Math.round(Number(stepCfg.value)) : null;
  if (step && Number.isFinite(step) && step > 0) {
    return Array.from({ length: 10 }, (_, i) => Math.min(100, step * (i + 1)));
  }
  return Array.from({ length: 10 }, () => 100);
}

/**
 * Cupos de premios anticipados según % vendido.
 * Ej. umbrales [10,20,30…]: al 15% hay 1 cupo; al 25% hay 2. Cualquiera de los 10 anticipados
 * puede ganar si el cliente compra su número bendecido (no hace falta ir en orden 1→2→3).
 */
function maxCuposAnticipados(pctVendido, thresholds) {
  return thresholds.filter((t) => pctVendido >= t).length;
}

/** Cuántos anticipados distintos ya tienen ganador en la campaña. */
async function countBeneficiosAnticipadosCampana(sorteoMayorId) {
  if (sorteoMayorId) {
    const row = await db.prepare(`
      SELECT COUNT(DISTINCT b.sorteo_id) AS n
      FROM beneficios_anticipados b
      JOIN sorteos s ON s.id = b.sorteo_id
      WHERE s.tipo = 'anticipado' AND s.sorteo_mayor_id = ?
    `).get(sorteoMayorId);
    return Number(row?.n ?? 0);
  }
  const row = await db.prepare(`
    SELECT COUNT(DISTINCT b.sorteo_id) AS n
    FROM beneficios_anticipados b
    JOIN sorteos s ON s.id = b.sorteo_id
    WHERE s.tipo = 'anticipado'
  `).get();
  return Number(row?.n ?? 0);
}

/** Rechaza cantidad de stikers fuera del límite por compra. */
function assertStickerCount(stickerCount) {
  const qty = Math.max(0, Math.round(Number(stickerCount)));
  if (qty === 0) {
    return { ok: false, status: 400, error: 'Selecciona al menos un stiker.' };
  }
  if (qty > maxStickersPerOrder) {
    return {
      ok: false,
      status: 400,
      error: `Máximo ${maxStickersPerOrder} stikers por compra. Reduce la selección e inténtalo de nuevo.`
    };
  }
  return { ok: true, qty };
}

/** Rechaza montos que no coincidan con precio × cantidad (el cliente no puede manipular amount). */
async function assertCheckoutAmount(amount, stickerCount) {
  const countCheck = assertStickerCount(stickerCount);
  if (!countCheck.ok) return countCheck;
  const qty = countCheck.qty;
  const unit = await getPrecioStikerCents();
  const expected = unit * qty;
  const received = Math.round(Number(amount));
  if (received !== expected) {
    return {
      ok: false,
      status: 400,
      error: `Monto incorrecto. Se esperaban ${expected} centavos (${qty} stiker(s) × ${unit}).`
    };
  }
  return { ok: true, expected };
}

/** Error HTTP con código para rutas Express. */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Quita números bendecidos de sorteos anticipados en respuestas públicas. */
function sorteoPublico(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  if ((out.tipo || '').toLowerCase() === 'anticipado') {
    delete out.numeros_beneficiados;
  }
  return out;
}

/**
 * Reserva stikers dentro de una transacción (FOR UPDATE) e inserta orden + items.
 * @param {'pending'|'paid'} orderStatus
 */
async function reservarStikersEnTransaccion(tx, {
  orderId,
  selectedStikers,
  cedula,
  nombre,
  customerEmail,
  telefono,
  amount,
  currency,
  sorteoMayorId,
  orderStatus
}) {
  if (!selectedStikers?.length) {
    throw httpError(400, 'Selecciona al menos un stiker.');
  }
  const params = selectedStikers.flatMap((s) => [s.numeroA, s.numeroB]);
  const placeholders = selectedStikers.map(() => '(?, ?)').join(', ');
  const slots = await tx.prepare(`
    SELECT id, numero_a, numero_b, order_id
    FROM stiker_slots
    WHERE (numero_a, numero_b) IN (${placeholders})
    FOR UPDATE
  `).all(...params);

  if (slots.length !== selectedStikers.length) {
    throw httpError(409, 'Algunos stikers ya no están disponibles. Actualiza la página y elige de nuevo.');
  }
  const ocupados = slots.filter((s) => s.order_id != null);
  if (ocupados.length > 0) {
    throw httpError(409, 'Algunos stikers ya no están disponibles. Actualiza la página y elige de nuevo.');
  }

  await tx.prepare(`
    INSERT INTO orders (id, cedula, nombre, email, telefono, total_cents, currency, status, sorteo_mayor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(orderId, cedula, nombre, customerEmail, telefono, amount, currency.toLowerCase(), orderStatus, sorteoMayorId);

  const insertItem = tx.prepare(`
    INSERT INTO order_items (order_id, numero_a, numero_b) VALUES (?, ?, ?)
  `);
  for (const s of selectedStikers) {
    await insertItem.run(orderId, s.numeroA, s.numeroB);
  }

  const updateSlot = tx.prepare(`
    UPDATE stiker_slots SET order_id = ? WHERE numero_a = ? AND numero_b = ? AND order_id IS NULL
  `);
  for (const s of selectedStikers) {
    await updateSlot.run(orderId, s.numeroA, s.numeroB);
  }
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
             CASE
               WHEN ss.order_id IS NOT NULL AND o.status = 'paid' THEN 'ocupado'
               WHEN ss.order_id IS NOT NULL AND o.status = 'pending' THEN 'reservado'
               ELSE 'libre'
             END AS estado
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

app.get('/api/verificar-stikers', verificarRateLimit, async (req, res) => {
  try {
    const cedula = (req.query.cedula || '').trim();
    if (!cedula) {
      return res.status(400).json({ error: 'Falta el parámetro cedula' });
    }

    const orders = await db.prepare(`
      SELECT id, stripe_session_id, status, total_cents, created_at
      FROM orders
      WHERE cedula = ? AND status = 'paid'
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
          pagado: true
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

    const amountCheck = await assertCheckoutAmount(amount, selectedStikers.length);
    if (!amountCheck.ok) {
      return res.status(amountCheck.status).json({ error: amountCheck.error });
    }

    if (!wompiEnabled) {
      const hintSandbox =
        'Configura Wompi en server/.env (WOMPI_PUBLIC_KEY, WOMPI_INTEGRITY_SECRET, WOMPI_EVENTS_SECRET). Para pruebas sin cobro real usa llaves de sandbox (pub_test_*).';
      const hintSimulate = simulatePaymentAllowed
        ? ' En este entorno (desarrollo) también puedes usar "Simular pago".'
        : '';
      return res.status(503).json({
        error: `Pagos con tarjeta en mantenimiento. ${hintSandbox}${hintSimulate}`
      });
    }

    const orderId = randomUUID();
    const cedula = (metadata.cedula || '').trim();
    const nombre = (customerName || '').trim() || 'Cliente';
    const telefono = (metadata.telefono || '').trim();

    if (selectedStikers.length > 0) {
      const sorteoMayorId = await getPremioMayorActivoId();
      const runTx = db.transaction(async (tx) => {
        await reservarStikersEnTransaccion(tx, {
          orderId,
          selectedStikers,
          cedula,
          nombre,
          customerEmail,
          telefono,
          amount,
          currency,
          sorteoMayorId,
          orderStatus: 'pending'
        });
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
    if (err.status === 409 || err.status === 400) {
      return res.status(err.status).json({ error: err.message });
    }
    res.status(500).json({
      error: err.message || 'Error al crear la sesión de pago'
    });
  }
});

// ----- SIMULAR PAGO (solo desarrollo: registra orden pagada sin pasarela) -----
app.post('/api/simulate-payment', async (req, res) => {
  try {
    if (!simulatePaymentAllowed) {
      return res.status(403).json({
        error:
          'Simular pago no está disponible en producción. Usa Wompi con claves de sandbox (pub_test_*) en .env para pruebas sin afectar cobros reales, o desarrolla solo con NODE_ENV distinto de production en local.'
      });
    }

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

    const amountCheck = await assertCheckoutAmount(amount, selectedStikers.length);
    if (!amountCheck.ok) {
      return res.status(amountCheck.status).json({ error: amountCheck.error });
    }

    const orderId = randomUUID();
    const cedula = (metadata.cedula || '').trim();
    const nombre = (customerName || '').trim() || 'Cliente';
    const telefono = (metadata.telefono || '').trim();

    const sorteoMayorId = await getPremioMayorActivoId();
    const runTx = db.transaction(async (tx) => {
      await reservarStikersEnTransaccion(tx, {
        orderId,
        selectedStikers,
        cedula,
        nombre,
        customerEmail,
        telefono,
        amount: Math.round(Number(amount)),
        currency: currency || 'cop',
        sorteoMayorId,
        orderStatus: 'paid'
      });
    });
    await runTx();
    await registrarBeneficiosAnticipados(orderId);
    enviarComprobanteTrasPago(orderId).catch(e => console.warn('Email comprobante:', e?.message));

    res.json({ sessionId: orderId, ok: true });
  } catch (err) {
    console.error('Error simulate-payment:', err);
    if (err.status === 409 || err.status === 400) {
      return res.status(err.status).json({ error: err.message });
    }
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
    const order = await db.prepare('SELECT id, status, total_cents FROM orders WHERE id = ?').get(reference);
    if (!order || order.status === 'paid') return res.sendStatus(200);
    const wompiAmount = Math.round(Number(transaction.amount_in_cents));
    const orderAmount = Math.round(Number(order.total_cents));
    if (Number.isFinite(wompiAmount) && wompiAmount > 0 && wompiAmount !== orderAmount) {
      console.warn('Webhook Wompi: monto no coincide', reference, 'wompi=', wompiAmount, 'orden=', orderAmount);
      return res.status(400).send('Amount mismatch');
    }
    await db.prepare(`UPDATE orders SET status = 'paid', payment_reference = ?, stripe_session_id = ? WHERE id = ?`).run(transaction.id, transaction.id, reference);
    await registrarBeneficiosAnticipados(reference);
    console.log('Wompi: orden marcada como pagada:', reference);
    enviarComprobanteTrasPago(reference).catch(e => console.warn('Email comprobante:', e?.message));
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
    enviarComprobanteTrasPago(id).catch(e => console.warn('Email comprobante:', e?.message));

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
    const pendingOrders = await db.prepare("SELECT COUNT(*) as n FROM orders WHERE status = 'pending'").get();
    const totalStikersSold = await db.prepare(`
      SELECT COUNT(*) as n
      FROM stiker_slots ss
      JOIN orders o ON o.id = ss.order_id AND o.status = 'paid'
    `).get();
    const reservedStikers = await db.prepare(`
      SELECT COUNT(*) as n
      FROM stiker_slots ss
      JOIN orders o ON o.id = ss.order_id AND o.status = 'pending'
    `).get();
    const totalStikers = await db.prepare('SELECT COUNT(*) as n FROM stiker_slots').get();
    const totalRevenue = await db.prepare("SELECT COALESCE(SUM(total_cents), 0) as n FROM orders WHERE status = 'paid'").get();
    const beneficiosCount = await db.prepare('SELECT COUNT(*) as n FROM beneficios_anticipados').get();
    const avgOrder = await db.prepare(`
      SELECT COALESCE(AVG(total_cents), 0) as n FROM orders WHERE status = 'paid'
    `).get();
    const hoy = fechaHoyColombia();
    const ordersToday = await db.prepare(`
      SELECT COUNT(*) as n FROM orders
      WHERE status = 'paid' AND (created_at::date) = (?::date)
    `).get(hoy);
    const revenueToday = await db.prepare(`
      SELECT COALESCE(SUM(total_cents), 0) as n FROM orders
      WHERE status = 'paid' AND (created_at::date) = (?::date)
    `).get(hoy);
    const mayorActivo = await db.prepare(`
      SELECT id, nombre, fecha, premio_descripcion, estado
      FROM sorteos
      WHERE tipo = 'mayor' AND estado = 'programado'
      AND ((fecha::date) = (?::date) OR (fecha::date) > (?::date))
      ORDER BY fecha ASC
      LIMIT 1
    `).get(hoy, hoy);
    const anticipadosActivos = mayorActivo
      ? await db.prepare(`
          SELECT COUNT(*) as n FROM sorteos
          WHERE tipo = 'anticipado' AND estado = 'programado' AND sorteo_mayor_id = ?
        `).get(mayorActivo.id)
      : { n: 0 };
    const beneficiosHoy = await db.prepare(`
      SELECT COUNT(*) as n FROM beneficios_anticipados
      WHERE (created_at::date) = (?::date)
    `).get(hoy);

    const sold = Number(totalStikersSold?.n ?? 0);
    const total = Number(totalStikers?.n ?? 0);
    const pctSold = total > 0 ? Math.round((sold / total) * 10000) / 100 : 0;

    res.json(toJSONSafe({
      totalOrders: Number(totalOrders?.n ?? 0),
      pendingOrders: Number(pendingOrders?.n ?? 0),
      totalStikersSold: sold,
      reservedStikers: Number(reservedStikers?.n ?? 0),
      totalStikers: total,
      pctSold,
      totalRevenueCents: Number(totalRevenue?.n ?? 0),
      avgOrderCents: Math.round(Number(avgOrder?.n ?? 0)),
      ordersToday: Number(ordersToday?.n ?? 0),
      revenueTodayCents: Number(revenueToday?.n ?? 0),
      beneficiosCount: Number(beneficiosCount?.n ?? 0),
      beneficiosHoy: Number(beneficiosHoy?.n ?? 0),
      anticipadosActivos: Number(anticipadosActivos?.n ?? 0),
      campana: mayorActivo
        ? {
            id: mayorActivo.id,
            nombre: mayorActivo.nombre,
            fecha: mayorActivo.fecha,
            premio_descripcion: mayorActivo.premio_descripcion,
            estado: mayorActivo.estado
          }
        : null
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

// ----- CONFIG (público: precio stiker + enlaces de contacto / redes desde .env) -----

/** Valores de .env.example: no son enlaces reales y no deben pintarse en el footer. */
function isPlaceholderPublicUrl(value) {
  const v = (value || '').trim().toLowerCase();
  if (!v) return true;
  return (
    v.includes('xxxxxx') ||
    v.includes('tu-pagina') ||
    v.includes('tu-perfil') ||
    v.includes('@tu-usuario') ||
    v.includes('tudominio')
  );
}

function publicEnvUrl(key, fallback = '') {
  const raw = (process.env[key] || '').trim();
  if (!raw || isPlaceholderPublicUrl(raw)) return fallback;
  return raw;
}

function publicLinksFromEnv() {
  return {
    whatsappDudasUrl: publicEnvUrl('PUBLIC_WHATSAPP_DUDAS_URL', 'https://wa.me/573187936740'),
    whatsappComunidadUrl: publicEnvUrl('PUBLIC_WHATSAPP_COMUNIDAD_URL'),
    socialFacebookUrl: publicEnvUrl(
      'PUBLIC_SOCIAL_FACEBOOK_URL',
      'https://www.facebook.com/share/1LgDzheb4T/?mibextid=wwXIfr'
    ),
    socialInstagramUrl: publicEnvUrl(
      'PUBLIC_SOCIAL_INSTAGRAM_URL',
      'https://www.instagram.com/juegoslaciudadbonita_'
    ),
    socialTiktokUrl: publicEnvUrl('PUBLIC_SOCIAL_TIKTOK_URL')
  };
}

app.get('/api/config', async (req, res) => {
  const links = publicLinksFromEnv();
  try {
    const precio = await db.prepare("SELECT value FROM config WHERE key = 'precio_stiker_cents'").get();
    const currency = await db.prepare("SELECT value FROM config WHERE key = 'currency'").get();
    res.json({
      precioStikerCents: precio ? parseInt(precio.value, 10) : 5000,
      currency: currency ? currency.value : 'cop',
      maxStickersPerOrder,
      pendingOrderExpireMinutes,
      ...links
    });
  } catch (err) {
    console.error('Error GET /api/config:', err);
    res.json({
      precioStikerCents: 5000,
      currency: 'cop',
      maxStickersPerOrder,
      pendingOrderExpireMinutes,
      ...links
    });
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
    const { precioStikerCents, currency, anticipadoStepPercent, anticipadosPercent } = req.body;
    if (precioStikerCents !== undefined) {
      const cents = Math.round(Number(precioStikerCents));
      if (cents < 0) return res.status(400).json({ error: 'Precio debe ser >= 0' });
      await db.prepare("INSERT INTO config (key, value) VALUES ('precio_stiker_cents', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(cents));
    }
    if (currency !== undefined && typeof currency === 'string') {
      const val = currency.trim().toLowerCase();
      await db.prepare("INSERT INTO config (key, value) VALUES ('currency', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(val);
    }
    if (anticipadosPercent !== undefined) {
      const raw = typeof anticipadosPercent === 'string'
        ? anticipadosPercent.trim()
        : Array.isArray(anticipadosPercent)
          ? anticipadosPercent.join(',')
          : String(anticipadosPercent ?? '');
      const parts = raw.split(',').map((p) => parseInt(String(p).trim(), 10));
      if (parts.length === 0 || parts.some((n) => isNaN(n) || n <= 0 || n > 100)) {
        return res.status(400).json({ error: 'Cada porcentaje de anticipado debe estar entre 1 y 100.' });
      }
      const normalized = parts.slice(0, 10);
      while (normalized.length < 10) normalized.push(100);
      await db.prepare("INSERT INTO config (key, value) VALUES ('anticipados_percent', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(normalized.join(','));
    }
    if (anticipadoStepPercent !== undefined) {
      const step = Math.round(Number(anticipadoStepPercent));
      if (!Number.isFinite(step) || step <= 0 || step > 100) {
        return res.status(400).json({ error: 'El porcentaje para anticipados debe estar entre 1 y 100.' });
      }
      await db.prepare("INSERT INTO config (key, value) VALUES ('anticipado_step_percent', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(step));
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
    res.json(toJSONSafe({ sorteos: rows.map(sorteoPublico) }));
  } catch (err) {
    console.error('Error GET /api/sorteos:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sorteos/home', async (req, res) => {
  try {
    const hoy = fechaHoyColombia();

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
        SELECT s.id, s.nombre, s.fecha, s.premio_descripcion
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
          id: row.id,
          nombre: row.nombre,
          fecha: row.fecha,
          premio_descripcion: row.premio_descripcion,
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
      principal: principal ? sorteoPublico(principal) : null,
      anticipadosActuales,
      mayoresRealizados: mayoresRealizados.map(sorteoPublico)
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
    res.json(toJSONSafe(sorteoPublico(row)));
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
  const baseQuery = `
        SELECT id, numeros_beneficiados FROM sorteos
        WHERE tipo = 'anticipado' AND estado = 'programado'
        AND numeros_beneficiados IS NOT NULL AND TRIM(CAST(numeros_beneficiados AS TEXT)) <> ''
  `;
  const sorteosBenefAll = order.sorteo_mayor_id
    ? await db.prepare(baseQuery + ' AND sorteo_mayor_id = ? ORDER BY id ASC').all(order.sorteo_mayor_id)
    : await db.prepare(baseQuery + ' ORDER BY id ASC').all();

  let slotsRestantes = 10;
  try {
    const pctVendido = await getPctStikersVendidos();
    const thresholds = await getAnticipadosPercentThresholds();
    const maxCupos = maxCuposAnticipados(pctVendido, thresholds);
    const yaEntregados = await countBeneficiosAnticipadosCampana(order.sorteo_mayor_id);
    slotsRestantes = Math.max(0, maxCupos - yaEntregados);
  } catch (e) {
    console.warn('Config anticipados_percent:', e?.message || e);
  }
  if (slotsRestantes <= 0) return;

  const sorteosBenef = sorteosBenefAll;

  const insertBenef = db.prepare(`
    INSERT INTO beneficios_anticipados (sorteo_id, order_id, numero_a, numero_b, cedula, nombre, email, telefono)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const existsBenefEnSorteo = db.prepare(`
    SELECT 1 FROM beneficios_anticipados
    WHERE sorteo_id = ? AND (TRIM(CAST(numero_a AS TEXT)) = ? AND TRIM(CAST(numero_b AS TEXT)) = ?) LIMIT 1
  `);
  const sorteoYaTieneGanador = db.prepare(`
    SELECT 1 FROM beneficios_anticipados WHERE sorteo_id = ? LIMIT 1
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
      // Número bendecido de 4 cifras: coincide si está en numeroA o numeroB del par comprado.
      const matchNumero = numerosSueltos.has(s.numeroA) || numerosSueltos.has(s.numeroB);
      const matches = matchPar || matchNumero;
      const yaEnEsteSorteo = await existsBenefEnSorteo.get(srt.id, s.numeroA, s.numeroB);
      const anticipadoYaPremiado = await sorteoYaTieneGanador.get(srt.id);
      const yaGanoOtroAnticipado = order.sorteo_mayor_id
        ? await stickerYaGanoAnticipadoEnCampanha.get(orderId, s.numeroA, s.numeroB, order.sorteo_mayor_id)
        : await stickerYaGanoAnticipadoEnCampanha.get(orderId, s.numeroA, s.numeroB);
      if (matches && !yaEnEsteSorteo && !anticipadoYaPremiado && !yaGanoOtroAnticipado && slotsRestantes > 0) {
        await insertBenef.run(srt.id, orderId, s.numeroA, s.numeroB, order.cedula || null, order.nombre || null, order.email || null, order.telefono || null);
        slotsRestantes -= 1;
      }
    }
  }
}

// ----- ADMIN: listado completo de sorteos (incluye números bendecidos) -----

app.get('/api/admin/sorteos', async (req, res) => {
  try {
    const rows = await db.prepare(`SELECT ${sorteosSelect} FROM sorteos ORDER BY fecha ASC`).all();
    res.json(toJSONSafe({ sorteos: rows }));
  } catch (err) {
    console.error('Error GET /api/admin/sorteos:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/sorteos', async (req, res) => {
  try {
    const { nombre, fecha, descripcion, tipo = 'anticipado', premio_descripcion, imagen_url, numeros_beneficiados } = req.body;
    if (!nombre || !fecha) {
      return res.status(400).json({ error: 'Faltan nombre o fecha' });
    }
    if (tipo === 'mayor' && !(imagen_url && String(imagen_url).trim())) {
      return res.status(400).json({ error: 'Para Premio Mayor es obligatoria la URL de la imagen del premio (para el hero).' });
    }

    if ((tipo || '').toLowerCase() === 'mayor') {
      const paidCount = await db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'").get();
      if (Number(paidCount?.n || 0) > 0) {
        return res.status(400).json({
          error: 'Hay ventas pagadas en la campaña actual. Realiza el Premio Mayor antes de crear uno nuevo; crear otro borraría todas las ventas.'
        });
      }
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
    if (isProduction) {
      console.warn('⚠️  Wompi no configurado en producción. Define WOMPI_PUBLIC_KEY y WOMPI_INTEGRITY_SECRET (sandbox: pub_test_* para pruebas).');
    } else {
      console.warn('⚠️  Wompi no configurado. Define las claves en server/.env o usa "Simular pago" (solo con servidor en desarrollo).');
    }
  } else {
    console.log('💳 Wompi activo' + (wompiPublicKey.startsWith('pub_test_') ? ' (sandbox)' : ' (producción)'));
  }
  if (simulatePaymentAllowed) {
    console.log('🧪 Simular pago: habilitado (modo desarrollo). En producción (NODE_ENV=production) esta ruta queda desactivada.');
  }
  console.log(`⏱️  Pendientes sin pago: expiran a los ${pendingOrderExpireMinutes} min; limpieza automática cada ${Math.round(pendingCleanupIntervalMs / 60000)} min.`);
  if (!adminPassword) {
    console.warn('⚠️  ADMIN_PASSWORD no definida. El panel /admin no permitirá login.');
  }
  setTimeout(scheduleCleanup, 5000);
});

export default app;
