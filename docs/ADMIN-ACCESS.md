# Acceso al panel de administración

El panel de admin es la parte más importante del proyecto. Aquí se define cómo funciona el acceso y qué debes configurar.

---

## URL y requisitos

- **URL del panel:** `/admin` (por ejemplo `http://localhost:4200/admin` con el frontend en marcha).
- **Backend:** Debe estar corriendo (por ejemplo `http://localhost:3000`) y tener configurado el acceso en `server/.env`.

---

## Variables de entorno (server/.env)

| Variable         | Obligatoria | Descripción |
|------------------|-------------|-------------|
| `ADMIN_PASSWORD` | **Sí**      | Contraseña para iniciar sesión en el panel. En **producción** (`NODE_ENV=production`) el servidor no arranca si está vacía. |
| `JWT_SECRET`     | Recomendada | Secreto para firmar los JWT. Si no se define, se usa `ADMIN_PASSWORD`. En producción conviene definir un valor distinto. |

Copia `server/.env.example` a `server/.env` y rellena al menos `ADMIN_PASSWORD`.

---

## Flujo de acceso

1. El usuario abre `/admin`. El frontend muestra el formulario de login (contraseña).
2. Al enviar la contraseña, el frontend llama a `POST /api/admin/login` con `{ "password": "..." }`.
3. El backend comprueba que `ADMIN_PASSWORD` esté definida (si no, responde **503** "Admin no configurado").
4. Si la contraseña es incorrecta, responde **401** "Contraseña incorrecta". Si falta la contraseña en el body, **400** "Falta la contraseña".
5. Si es correcta, genera un JWT (válido **24 horas**) con `{ sub: 'admin', role: 'admin' }` y devuelve `{ "token": "..." }`.
6. El frontend guarda el token en **sessionStorage** (clave `admin_token`) y redirige a la vista del panel.
7. Todas las peticiones a rutas `/api/admin/*` (excepto `/api/admin/login`) envían el header `Authorization: Bearer <token>`.
8. El backend, en el middleware de admin, verifica el token. Si falta o es inválido/expirado responde **401** con mensaje claro ("Sesión expirada..." o "Sesión inválida...").
9. Si el frontend recibe 401 en cualquier petición de admin, el interceptor llama a `logout()` (borra el token) y el componente muestra de nuevo el formulario de login.

---

## Respuestas del backend (resumen)

| Situación              | Código | Mensaje (ejemplo) |
|------------------------|--------|--------------------|
| Admin no configurado   | 503    | Admin no configurado. Define ADMIN_PASSWORD en server/.env |
| Falta contraseña       | 400    | Falta la contraseña |
| Contraseña incorrecta  | 401    | Contraseña incorrecta |
| Sin token en petición  | 401    | No autorizado. Inicia sesión en /admin |
| Token expirado         | 401    | Sesión expirada. Vuelve a iniciar sesión. |
| Token inválido         | 401    | Sesión inválida. Vuelve a iniciar sesión. |

---

## Producción

- Con `NODE_ENV=production`, el servidor **no arranca** si `ADMIN_PASSWORD` está vacía o si no hay un secreto JWT válido (evita dejar el panel sin protección).
- Usa una contraseña fuerte y, si puedes, define `JWT_SECRET` distinto de la contraseña.
