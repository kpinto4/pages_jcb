/**
 * Punto de entrada unificado: SQLite (local) o PostgreSQL (Vercel/Supabase).
 * Si existe DATABASE_URL se usa PostgreSQL; si no, SQLite.
 */
import { initDb as initDbSqlite } from './db.js';
import { initDbPg } from './db-pg.js';

function wrapSqlite(syncDb) {
  const wrapper = {
    prepare(sql) {
      return {
        get: (...params) => Promise.resolve(syncDb.prepare(sql).get(...params)),
        all: (...params) => Promise.resolve(syncDb.prepare(sql).all(...params)),
        run: (...params) => Promise.resolve(syncDb.prepare(sql).run(...params))
      };
    },
    get(sql, ...params) {
      return Promise.resolve(syncDb.prepare(sql).get(...params));
    },
    all(sql, ...params) {
      return Promise.resolve(syncDb.prepare(sql).all(...params));
    },
    run(sql, ...params) {
      return Promise.resolve(syncDb.prepare(sql).run(...params));
    },
    exec(sql) {
      return Promise.resolve(syncDb.exec(sql));
    },
    transaction(fn) {
      return async function runTx() {
        syncDb.exec('BEGIN');
        try {
          const result = await fn(wrapper);
          syncDb.exec('COMMIT');
          return result;
        } catch (e) {
          syncDb.exec('ROLLBACK');
          throw e;
        }
      };
    }
  };
  return wrapper;
}

export async function initDb() {
  if (process.env.DATABASE_URL) {
    return initDbPg();
  }
  const syncDb = await initDbSqlite();
  return wrapSqlite(syncDb);
}
