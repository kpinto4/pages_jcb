/** Preload para `npm run start:prod`: evita depender de `cross-env` (en algunos hosts .bin no tiene permiso de ejecución). */
process.env.NODE_ENV = 'production';
