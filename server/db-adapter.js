/**
 * Punto de entrada de base de datos: solo PostgreSQL.
 * Requiere que DATABASE_URL esté definido en server/.env.
 */
import { initDbPg } from './db-pg.js';

export async function initDb() {
  return initDbPg();
}
