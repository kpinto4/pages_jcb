# PagesJcb

Proyecto **Juego de la Ciudad Bonita** (sorteos/stickers). Frontend Angular 19 y backend Express; pensado para ejecución **solo en local**.

## Ejecución en local

1. **Instalar dependencias** (raíz y backend):
   ```bash
   npm run install-all
   ```
   O por separado: `npm install` en la raíz y `npm install` dentro de `server/`.

2. **Configurar el backend**  
   En `server/` crea un archivo `.env` (copia `server/.env.example`). **Obligatorio para el panel de admin:**
   - `DATABASE_URL`: conexión a PostgreSQL (obligatoria).
   - `ADMIN_PASSWORD`: contraseña para entrar al panel (en producción el servidor no arranca sin ella).
   - `JWT_SECRET`: recomendado para firmar sesiones; si no se define se usa `ADMIN_PASSWORD`.
   Opcional: `STRIPE_*` para pagos (mientras tanto se usa "Simular pago").

3. **Arrancar backend** (puerto 3000):
   ```bash
   cd server && npm start
   ```

4. **Arrancar frontend** (puerto 4200):
   ```bash
   npm start
   ```
   En otra terminal si el backend ya está en marcha.

5. Abre **http://localhost:4200** en el navegador. La API está en **http://localhost:3000**.

## Acceso al panel de administración

- **URL:** [http://localhost:4200/admin](http://localhost:4200/admin) (con el frontend en marcha).
- **Requisitos:** En `server/.env` debes tener `ADMIN_PASSWORD` definida. Sin ella el login responde "Admin no configurado" y en producción el servidor no arranca.
- **Sesión:** Tras iniciar sesión con la contraseña correcta, el backend devuelve un JWT (válido 24 h). El frontend lo guarda en `sessionStorage` y lo envía en `Authorization: Bearer <token>` en todas las peticiones a `/api/admin/*`. Si el token expira o es inválido, el backend responde 401 y el frontend cierra sesión y muestra de nuevo el formulario de login.
- **Detalle:** Ver `server/.env.example` (sección "Acceso al panel de administración") y `docs/ADMIN-ACCESS.md`.

## Development server (solo frontend)

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
