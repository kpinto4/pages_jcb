import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Stripe from 'stripe';
import jwt from 'jsonwebtoken';
import { initDb } from './db.js';
import { randomUUID } from 'crypto';

const db = await initDb();
const app = express();
const port = process.env.PORT || 3000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const adminPassword = process.env.ADMIN_PASSWORD || '';
const jwtSecret = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'change-me-in-production';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Webhook debe leer body raw para verificar firma
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

// ----- ADMIN LOGIN (público, antes del middleware) -----

app.post('/api/admin/login', (req, res) => {
  try {
    const { password } = req.body || {};
    if (!adminPassword) {
      return res.status(503).json({ error: 'Admin no configurado. Define ADMIN_PASSWORD en .env' });
    }
    if (!password || password !== adminPassword) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    const token = jwt.sign(
      { sub: 'admin', role: 'admin' },
      jwtSecret,
      { expiresIn: '24h' }
    );
    res.json({ token });
  } catch (err) {
    console.error('Error login:', err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// Middleware: proteger todas las rutas /api/admin/* excepto login
function adminAuthMiddleware(req, res, next) {
  if (req.path === '/login' && req.method === 'POST') return next();

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión expirada o inválida. Vuelve a iniciar sesión.' });
  }
}

app.use('/api/admin', adminAuthMiddleware);

// ----- STIKERS -----

app.get('/api/stikers', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const rows = db.prepare(`
      SELECT id, numero_a as numeroA, numero_b as numeroB,
             CASE WHEN order_id IS NOT NULL THEN 'ocupado' ELSE 'libre' END as estado
      FROM stiker_slots
      ORDER BY id
      LIMIT ?
    `).all(limit);

    res.json({ stikers: rows });
  } catch (err) {
    console.error('Error GET /api/stikers:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----- BOLETAS (verificar por cédula) -----

app.get('/api/boletas', (req, res) => {
  try {
    const cedula = (req.query.cedula || '').trim();
    if (!cedula) {
      return res.status(400).json({ error: 'Falta el parámetro cedula' });
    }

    const orders = db.prepare(`
      SELECT id, stripe_session_id, status, total_cents, created_at
      FROM orders
      WHERE cedula = ?
      ORDER BY created_at DESC
    `).all(cedula);

    const boletas = [];
    for (const order of orders) {
      const items = db.prepare(`
        SELECT numero_a, numero_b FROM order_items WHERE order_id = ?
      `).all(order.id);
      for (const item of items) {
        boletas.push({
          codigo: `STK-${order.id.slice(0, 8).toUpperCase()}`,
          numero1: item.numero_a,
          numero2: item.numero_b,
          pagado: order.status === 'paid'
        });
      }
    }

    res.json({ boletas });
  } catch (err) {
    console.error('Error GET /api/boletas:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----- CHECKOUT (crear sesión Stripe y reservar stikers) -----

app.post('/api/create-checkout-session', async (req, res) => {
  try {
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

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        error: 'STRIPE_SECRET_KEY no configurada. Revisa el archivo .env del servidor.'
      });
    }

    const orderId = randomUUID();
    const cedula = (metadata.cedula || '').trim();
    const nombre = (customerName || '').trim() || 'Cliente';

    if (selectedStikers.length > 0) {
      const params = selectedStikers.flatMap(s => [s.numeroA, s.numeroB]);
      const placeholders = selectedStikers.map(() => '(?, ?)').join(', ');
      const slots = db.prepare(`
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

      db.transaction(() => {
        db.prepare(`
          INSERT INTO orders (id, cedula, nombre, email, telefono, total_cents, currency, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        `).run(orderId, cedula, nombre, customerEmail, (metadata.telefono || '').trim(), amount, currency.toLowerCase());

        const insertItem = db.prepare(`
          INSERT INTO order_items (order_id, numero_a, numero_b) VALUES (?, ?, ?)
        `);
        for (const s of selectedStikers) {
          insertItem.run(orderId, s.numeroA, s.numeroB);
        }

        const updateSlot = db.prepare(`
          UPDATE stiker_slots SET order_id = ? WHERE numero_a = ? AND numero_b = ?
        `);
        for (const s of selectedStikers) {
          updateSlot.run(orderId, s.numeroA, s.numeroB);
        }
      })();
    } else {
      db.prepare(`
        INSERT INTO orders (id, cedula, nombre, email, telefono, total_cents, currency, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(orderId, cedula, nombre, customerEmail, (metadata.telefono || '').trim(), amount, currency.toLowerCase());
    }

    const sessionConfig = {
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customerEmail,
      client_reference_id: orderId,
      line_items: lineItems && lineItems.length > 0
        ? lineItems.map((item) => ({
            price_data: {
              currency: currency.toLowerCase(),
              product_data: {
                name: item.name || 'Stiker Ciudad Bonita',
                description: item.description,
                images: item.image ? [item.image] : undefined
              },
              unit_amount: Math.round(item.unit_amount)
            },
            quantity: item.quantity || 1
          }))
        : [{
            price_data: {
              currency: currency.toLowerCase(),
              product_data: {
                name: 'Stikers - Juego de la Ciudad Bonita',
                description: metadata.stikersDetail || 'Compra de stikers'
              },
              unit_amount: Math.round(amount)
            },
            quantity: 1
          }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        ...metadata,
        customerName: nombre,
        orderId
      }
    };

    const session = await stripe.checkout.sessions.create(sessionConfig);

    db.prepare(`
      UPDATE orders SET stripe_session_id = ? WHERE id = ?
    `).run(session.id, orderId);

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Error creando sesión Stripe:', err);
    res.status(500).json({
      error: err.message || 'Error al crear la sesión de pago'
    });
  }
});

// ----- SESIÓN (detalle tras pago) -----

app.get('/api/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe no configurado' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items']
    });

    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'La sesión no está pagada' });
    }

    const orderId = session.metadata?.orderId;
    let stikersDetail = session.metadata?.stikersDetail || '';
    if (orderId) {
      const items = db.prepare(`
        SELECT numero_a, numero_b FROM order_items WHERE order_id = ?
      `).all(orderId);
      if (items.length > 0) {
        stikersDetail = items.map(i => `${i.numero_a} - ${i.numero_b}`).join(', ');
      }
    }

    res.json({
      id: session.id,
      customer_email: session.customer_details?.email,
      amount_total: session.amount_total,
      currency: session.currency,
      metadata: { ...session.metadata, stikersDetail }
    });
  } catch (err) {
    console.error('Error obteniendo sesión:', err);
    res.status(500).json({ error: err.message || 'Error al obtener la sesión' });
  }
});

// ----- WEBHOOK STRIPE -----

app.post('/api/webhooks/stripe', (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    if (stripeWebhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, stripeWebhookSecret);
    } else {
      event = req.body;
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;
    if (orderId) {
      try {
        db.prepare(`UPDATE orders SET status = 'paid' WHERE id = ?`).run(orderId);
        console.log('Orden marcada como pagada:', orderId);
      } catch (e) {
        console.error('Error actualizando orden:', e);
      }
    }
  }

  res.sendStatus(200);
});

// ----- ADMIN (opcional) -----

app.get('/api/admin/orders', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const rows = db.prepare(`
      SELECT o.id, o.cedula, o.nombre, o.email, o.total_cents, o.currency, o.status, o.created_at,
             (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as items_count
      FROM orders o
      ORDER BY o.created_at DESC
      LIMIT ?
    `).all(limit);
    res.json({ orders: rows });
  } catch (err) {
    console.error('Error GET /api/admin/orders:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/stats', (req, res) => {
  try {
    const totalOrders = db.prepare("SELECT COUNT(*) as n FROM orders WHERE status = 'paid'").get();
    const totalStikersSold = db.prepare('SELECT COUNT(*) as n FROM stiker_slots WHERE order_id IS NOT NULL').get();
    const totalRevenue = db.prepare("SELECT COALESCE(SUM(total_cents), 0) as n FROM orders WHERE status = 'paid'").get();
    res.json({
      totalOrders: totalOrders.n,
      totalStikersSold: totalStikersSold.n,
      totalRevenueCents: totalRevenue.n
    });
  } catch (err) {
    console.error('Error GET /api/admin/stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----- CONFIG (público: precio stiker para la tienda) -----

app.get('/api/config', (req, res) => {
  try {
    const precio = db.prepare("SELECT value FROM config WHERE key = 'precio_stiker_cents'").get();
    const currency = db.prepare("SELECT value FROM config WHERE key = 'currency'").get();
    res.json({
      precioStikerCents: precio ? parseInt(precio.value, 10) : 5000,
      currency: currency ? currency.value : 'usd'
    });
  } catch (err) {
    console.error('Error GET /api/config:', err);
    res.json({ precioStikerCents: 5000, currency: 'usd' });
  }
});

// ----- ADMIN CONFIG -----

app.get('/api/admin/config', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM config').all();
    const config = {};
    for (const r of rows) config[r.key] = r.value;
    res.json(config);
  } catch (err) {
    console.error('Error GET /api/admin/config:', err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/config', (req, res) => {
  try {
    const { precioStikerCents, currency } = req.body;
    if (precioStikerCents !== undefined) {
      const cents = Math.round(Number(precioStikerCents));
      if (cents < 0) return res.status(400).json({ error: 'Precio debe ser >= 0' });
      db.prepare("INSERT INTO config (key, value) VALUES ('precio_stiker_cents', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(cents));
    }
    if (currency !== undefined && typeof currency === 'string') {
      const val = currency.trim().toLowerCase();
      db.prepare("INSERT INTO config (key, value) VALUES ('currency', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(val);
    }
    const rows = db.prepare('SELECT key, value FROM config').all();
    const config = {};
    for (const r of rows) config[r.key] = r.value;
    res.json(config);
  } catch (err) {
    console.error('Error PATCH /api/admin/config:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----- SORTEOS (público y admin) -----

const sorteosSelect = 'id, nombre, fecha, descripcion, tipo, estado, premio_descripcion, numero_ganador_a, numero_ganador_b, created_at';

app.get('/api/sorteos', (req, res) => {
  try {
    const estado = req.query.estado;
    let sql = `SELECT ${sorteosSelect} FROM sorteos ORDER BY fecha ASC`;
    const params = [];
    if (estado) {
      sql = `SELECT ${sorteosSelect} FROM sorteos WHERE estado = ? ORDER BY fecha ASC`;
      params.push(estado);
    }
    const rows = db.prepare(sql).all(...params);
    res.json({ sorteos: rows });
  } catch (err) {
    console.error('Error GET /api/sorteos:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sorteos/:id', (req, res) => {
  try {
    const row = db.prepare(`SELECT ${sorteosSelect} FROM sorteos WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Sorteo no encontrado' });
    res.json(row);
  } catch (err) {
    console.error('Error GET /api/sorteos/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/sorteos', (req, res) => {
  try {
    const { nombre, fecha, descripcion, tipo = 'anticipado', premio_descripcion } = req.body;
    if (!nombre || !fecha) {
      return res.status(400).json({ error: 'Faltan nombre o fecha' });
    }
    const result = db.prepare(`
      INSERT INTO sorteos (nombre, fecha, descripcion, tipo, estado, premio_descripcion)
      VALUES (?, ?, ?, ?, 'programado', ?)
    `).run(nombre, fecha, descripcion || '', tipo, premio_descripcion || null);
    const row = db.prepare('SELECT * FROM sorteos WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    console.error('Error POST /api/admin/sorteos:', err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/sorteos/:id', (req, res) => {
  try {
    const { nombre, fecha, descripcion, tipo, estado, premio_descripcion } = req.body;
    const id = req.params.id;
    const current = db.prepare('SELECT * FROM sorteos WHERE id = ?').get(id);
    if (!current) return res.status(404).json({ error: 'Sorteo no encontrado' });

    const updates = [];
    const params = [];
    if (nombre !== undefined) { updates.push('nombre = ?'); params.push(nombre); }
    if (fecha !== undefined) { updates.push('fecha = ?'); params.push(fecha); }
    if (descripcion !== undefined) { updates.push('descripcion = ?'); params.push(descripcion); }
    if (tipo !== undefined) { updates.push('tipo = ?'); params.push(tipo); }
    if (estado !== undefined) { updates.push('estado = ?'); params.push(estado); }
    if (premio_descripcion !== undefined) { updates.push('premio_descripcion = ?'); params.push(premio_descripcion); }
    if (updates.length === 0) return res.json(current);

    params.push(id);
    db.prepare(`UPDATE sorteos SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const row = db.prepare('SELECT * FROM sorteos WHERE id = ?').get(id);
    res.json(row);
  } catch (err) {
    console.error('Error PATCH /api/admin/sorteos/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/sorteos/:id/realizar', (req, res) => {
  try {
    const id = req.params.id;
    const sorteo = db.prepare('SELECT * FROM sorteos WHERE id = ?').get(id);
    if (!sorteo) return res.status(404).json({ error: 'Sorteo no encontrado' });
    if (sorteo.estado === 'realizado') {
      return res.status(400).json({ error: 'Este sorteo ya fue realizado' });
    }

    const items = db.prepare(`
      SELECT oi.numero_a, oi.numero_b, oi.order_id
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'paid'
      ORDER BY RANDOM()
      LIMIT 1
    `).get();

    let numero_ganador_a = null;
    let numero_ganador_b = null;
    if (items) {
      numero_ganador_a = items.numero_a;
      numero_ganador_b = items.numero_b;
    }

    db.prepare(`
      UPDATE sorteos SET estado = 'realizado', numero_ganador_a = ?, numero_ganador_b = ? WHERE id = ?
    `).run(numero_ganador_a, numero_ganador_b, id);

    const updated = db.prepare('SELECT * FROM sorteos WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    console.error('Error POST /api/admin/sorteos/:id/realizar:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----- HEALTH -----

app.get('/api/health', (_, res) => {
  res.json({
    ok: true,
    stripe: !!process.env.STRIPE_SECRET_KEY,
    db: true
  });
});

app.listen(port, () => {
  console.log(`Servidor en http://localhost:${port}`);
  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn('⚠️  STRIPE_SECRET_KEY no definida. Crea server/.env con tu clave.');
  }
  if (!stripeWebhookSecret) {
    console.warn('⚠️  STRIPE_WEBHOOK_SECRET no definida. Los webhooks no verificarán firma.');
  }
  if (!adminPassword) {
    console.warn('⚠️  ADMIN_PASSWORD no definida. El panel /admin no permitirá login.');
  }
});
