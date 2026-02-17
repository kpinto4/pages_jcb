import initSqlJs from 'sql.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.SQLITE_PATH || join(__dirname, 'data.db');

let SQL = null;
let sqliteDb = null;
let inTransaction = false;

function save() {
  if (!sqliteDb || inTransaction) return;
  const data = sqliteDb.export();
  writeFileSync(dbPath, Buffer.from(data));
}

function prepare(sql) {
  return {
    run(...params) {
      const stmt = sqliteDb.prepare(sql);
      if (params.length) stmt.bind(params);
      stmt.step();
      stmt.free();
      const lid = sqliteDb.exec("SELECT last_insert_rowid() AS id");
      const lastInsertRowid = lid.length && lid[0].values.length ? lid[0].values[0][0] : 0;
      save();
      return { lastInsertRowid };
    },
    get(...params) {
      const stmt = sqliteDb.prepare(sql);
      if (params.length) stmt.bind(params);
      const hasRow = stmt.step();
      const row = hasRow ? stmt.getAsObject() : undefined;
      stmt.free();
      return row;
    },
    all(...params) {
      const stmt = sqliteDb.prepare(sql);
      if (params.length) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    }
  };
}

function exec(sql) {
  sqliteDb.exec(sql);
  save();
}

function pragma(name, value) {
  const v = value !== undefined ? (typeof value === 'string' ? `'${value}'` : value) : '';
  const sql = v ? `PRAGMA ${name} = ${v}` : `PRAGMA ${name}`;
  sqliteDb.run(sql);
}

function transaction(fn) {
  return function runTransaction() {
    inTransaction = true;
    sqliteDb.run('BEGIN');
    try {
      fn();
      sqliteDb.run('COMMIT');
      inTransaction = false;
      save();
    } catch (e) {
      sqliteDb.run('ROLLBACK');
      inTransaction = false;
      throw e;
    }
  };
}

function createDbWrapper() {
  return {
    prepare,
    exec,
    pragma,
    transaction
  };
}

export async function initDb() {
  if (sqliteDb) return createDbWrapper();
  SQL = await initSqlJs();
  if (existsSync(dbPath)) {
    const buf = readFileSync(dbPath);
    sqliteDb = new SQL.Database(buf);
  } else {
    sqliteDb = new SQL.Database();
  }

  const db = createDbWrapper();
  db.pragma('journal_mode', 'WAL');
  db.pragma('foreign_keys', 'ON');

  function initSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        stripe_session_id TEXT UNIQUE,
        cedula TEXT NOT NULL,
        nombre TEXT NOT NULL,
        email TEXT NOT NULL,
        telefono TEXT,
        total_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'usd',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        numero_a TEXT NOT NULL,
        numero_b TEXT NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id)
      );

      CREATE TABLE IF NOT EXISTS stiker_slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero_a TEXT NOT NULL,
        numero_b TEXT NOT NULL,
        order_id TEXT,
        UNIQUE(numero_a, numero_b),
        FOREIGN KEY (order_id) REFERENCES orders(id)
      );

      CREATE TABLE IF NOT EXISTS sorteos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        fecha TEXT NOT NULL,
        descripcion TEXT,
        tipo TEXT NOT NULL DEFAULT 'anticipado',
        estado TEXT NOT NULL DEFAULT 'programado',
        premio_descripcion TEXT,
        numero_ganador_a TEXT,
        numero_ganador_b TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_orders_cedula ON orders(cedula);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_stiker_slots_order ON stiker_slots(order_id);
      CREATE INDEX IF NOT EXISTS idx_sorteos_fecha ON sorteos(fecha);
      CREATE INDEX IF NOT EXISTS idx_sorteos_estado ON sorteos(estado);
    `);
  }

  function seedStikerSlots(count = 300) {
    const existing = db.prepare('SELECT COUNT(*) as n FROM stiker_slots').get();
    if (existing.n > 0) return;

    const insert = db.prepare('INSERT INTO stiker_slots (numero_a, numero_b) VALUES (?, ?)');
    const random4 = () => Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const seen = new Set();

    for (let i = 0; i < count; i++) {
      let a = random4();
      let b = random4();
      const key = `${a}-${b}`;
      if (seen.has(key)) {
        i--;
        continue;
      }
      seen.add(key);
      insert.run(a, b);
    }
    console.log(`Se crearon ${count} stiker_slots.`);
  }

  function seedSorteos() {
    const existing = db.prepare('SELECT COUNT(*) as n FROM sorteos').get();
    if (existing.n > 0) return;

    db.prepare(`
      INSERT INTO sorteos (nombre, fecha, descripcion, tipo, estado, premio_descripcion) VALUES
      ('Premio Anticipado #1', '2026-02-15', 'Primer sorteo anticipado', 'anticipado', 'programado', 'Bono $100.000'),
      ('Premio Anticipado #2', '2026-02-22', 'Segundo sorteo anticipado', 'anticipado', 'programado', 'Audífonos premium'),
      ('Premio Anticipado #3', '2026-02-29', 'Tercer sorteo anticipado', 'anticipado', 'programado', 'Bono gasolina'),
      ('Premio Mayor', '2026-03-01', 'Sorteo del premio mayor', 'mayor', 'programado', 'Moto 0 KM + bonos sorpresa')
    `).run();
    console.log('Se crearon sorteos iniciales.');
  }

  function seedConfig() {
    const existing = db.prepare('SELECT COUNT(*) as n FROM config').get();
    if (existing.n > 0) return;
    db.prepare(`
      INSERT INTO config (key, value) VALUES
      ('precio_stiker_cents', '5000'),
      ('currency', 'usd')
    `).run();
    console.log('Se creó config inicial (precio stiker $50 USD).');
  }

  function migrateSorteosPremio() {
    try {
      const info = db.prepare('PRAGMA table_info(sorteos)').all();
      if (info.some(c => c.name === 'premio_descripcion')) return;
      db.prepare('ALTER TABLE sorteos ADD COLUMN premio_descripcion TEXT').run();
      console.log('Migración: columna premio_descripcion añadida a sorteos.');
    } catch (_) {}
  }

  initSchema();
  migrateSorteosPremio();
  seedStikerSlots(300);
  seedSorteos();
  seedConfig();
  return db;
}
