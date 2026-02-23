/**
 * Adaptador PostgreSQL para Vercel/Supabase.
 * Si DATABASE_URL es de Neon, usa @neondatabase/serverless (mejor en serverless).
 * Si no, usa pg (node-postgres).
 */
let pool = null;

async function getPool() {
  if (!pool) {
    let connectionString = (process.env.DATABASE_URL || '').trim().replace(/[\r\n]+/g, '').trim();
    if (!connectionString) throw new Error('DATABASE_URL no definida');
    if (!connectionString.includes('@') || !connectionString.includes('.')) {
      throw new Error('DATABASE_URL no parece una URL válida (debe ser postgresql://usuario:pass@host.dominio/db)');
    }
    const isNeon = connectionString.includes('neon.tech');
    if (isNeon) {
      const { Pool, neonConfig } = await import('@neondatabase/serverless');
      try {
        const ws = (await import('ws')).default;
        neonConfig.webSocketConstructor = ws;
      } catch (_) {}
      pool = new Pool({ connectionString });
    } else {
      const pg = await import('pg');
      const useSsl = connectionString.includes('supabase') || connectionString.includes('sslmode=require');
      pool = new pg.default.Pool({
        connectionString,
        ssl: useSsl ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 10000
      });
    }
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
  const p = await getPool();
  const res = await p.query(pgSql, pgParams);
  return res;
}

function runPg(sql, params) {
  const isInsert = sql.trim().toUpperCase().startsWith('INSERT');
  let runSql = sql;
  if (isInsert && !/RETURNING\s+/i.test(sql)) {
    runSql = sql.replace(/;\s*$/, '') + ' RETURNING id';
  }
  return query(runSql, params).then(res => {
    const id = isInsert && res.rows && res.rows[0] ? res.rows[0].id : 0;
    const lastInsertRowid = typeof id === 'bigint' ? Number(id) : (id || 0);
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
    const p = await getPool();
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const st of statements) {
      await p.query(st);
    }
  },

  transaction(fn) {
    return async function runTx() {
      const p = await getPool();
      const client = await p.connect();
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
  const p = await getPool();
  await p.query('SELECT 1');
  return dbPg;
}
