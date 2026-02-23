/**
 * Adaptador PostgreSQL para Vercel/Supabase.
 * Usar cuando DATABASE_URL esté definida (ej. en Vercel).
 */
import pg from 'pg';

const { Pool } = pg;

let pool = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL no definida');
    const useSsl = connectionString.includes('supabase') || connectionString.includes('neon.tech') || connectionString.includes('sslmode=require');
    pool = new Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000
    });
  }
  return pool;
}

/** Convierte ? en SQL a $1, $2, ... y devuelve { sql, params } */
function toPgParams(sql, params = []) {
  if (!params.length) return { sql, params };
  let i = 0;
  const sql2 = sql.replace(/\?/g, () => `$${++i}`);
  return { sql: sql2, params };
}

async function query(sql, params = []) {
  const { sql: pgSql, params: pgParams } = toPgParams(sql, params);
  const res = await getPool().query(pgSql, pgParams);
  return res;
}

function runPg(sql, params) {
  const isInsert = sql.trim().toUpperCase().startsWith('INSERT');
  let runSql = sql;
  if (isInsert && !/RETURNING\s+/i.test(sql)) {
    runSql = sql.replace(/;\s*$/, '') + ' RETURNING id';
  }
  return query(runSql, params).then(res => {
    const lastInsertRowid = isInsert && res.rows && res.rows[0] ? res.rows[0].id : 0;
    return { lastInsertRowid };
  });
}

export const dbPg = {
  prepare(sql) {
    return {
      get: (...params) => query(sql, params).then(res => res.rows[0]),
      all: (...params) => query(sql, params).then(res => res.rows),
      run: (...params) => runPg(sql, params)
    };
  },

  async get(sql, ...params) {
    const res = await query(sql, params);
    return res.rows[0];
  },

  async all(sql, ...params) {
    const res = await query(sql, params);
    return res.rows;
  },

  async run(sql, ...params) {
    return runPg(sql, params);
  },

  async exec(sql) {
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const st of statements) {
      await getPool().query(st);
    }
  },

  transaction(fn) {
    return async function runTx() {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        const txDb = {
          prepare(sql) {
            return {
              get: (...p) => {
                const { sql: pgSql, params } = toPgParams(sql, p);
                return client.query(pgSql, params).then(r => r.rows[0]);
              },
              all: (...p) => {
                const { sql: pgSql, params } = toPgParams(sql, p);
                return client.query(pgSql, params).then(r => r.rows);
              },
              run: async (...p) => {
                const isInsert = sql.trim().toUpperCase().startsWith('INSERT');
                let runSql = sql;
                if (isInsert && !/RETURNING\s+/i.test(sql)) runSql = sql.replace(/;\s*$/, '') + ' RETURNING id';
                const { sql: pgSql, params } = toPgParams(runSql, p);
                const res = await client.query(pgSql, params);
                return { lastInsertRowid: isInsert && res.rows?.[0] ? res.rows[0].id : 0 };
              }
            };
          },
          get: (s, ...p) => {
            const { sql: pgSql, params } = toPgParams(s, p);
            return client.query(pgSql, params).then(r => r.rows[0]);
          },
          all: (s, ...p) => {
            const { sql: pgSql, params } = toPgParams(s, p);
            return client.query(pgSql, params).then(r => r.rows);
          },
          run: async (s, ...p) => {
            const isInsert = s.trim().toUpperCase().startsWith('INSERT');
            let runSql = s;
            if (isInsert && !/RETURNING\s+/i.test(s)) runSql = s.replace(/;\s*$/, '') + ' RETURNING id';
            const { sql: pgSql, params } = toPgParams(runSql, p);
            const res = await client.query(pgSql, params);
            return { lastInsertRowid: isInsert && res.rows?.[0] ? res.rows[0].id : 0 };
          },
          exec: async (execSql) => {
            const statements = execSql.split(';').map(x => x.trim()).filter(Boolean);
            for (const st of statements) await client.query(st);
          }
        };
        const result = await fn(txDb);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    };
  }
};

export async function initDbPg() {
  await getPool().query('SELECT 1');
  return dbPg;
}
