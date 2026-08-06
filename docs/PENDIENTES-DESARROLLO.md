# Pendientes de desarrollo — Juego de la Ciudad Bonita

Documento de trabajo para sesiones futuras. Lo **crítico para producción** ya está en código; aquí van mejoras opcionales, pulido y tareas operativas que quedaron fuera del alcance inmediato.

**Última actualización:** junio 2025

> **Nota:** La sección **G** es de **otro producto** (pantalla de planes SaaS de las capturas), no del sitio de stikers. Abrir el repo correcto para implementarla.

---

## Cómo usar este documento

- Marca `[x]` cuando completes un ítem.
- Prioridad: **Media** = conviene antes o poco después del lanzamiento · **Baja** = mejora de calidad, no bloquea ventas.

---

## A. Pulido de código (frontend / UX)

### A1. Confirmación doble al crear Premio Mayor — **Media**

**Problema:** El backend ya bloquea crear un Premio Mayor si hay ventas `paid`, pero en admin un clic accidental sigue siendo riesgoso si no hay ventas.

**Qué hacer:**
- En `admin.component.ts` / `admin.component.html`, antes de `crearSorteo` tipo `mayor`:
  - Primer diálogo: explicar que se reinician stikers y anticipados.
  - Segundo paso: escribir confirmación (ej. `CREAR`) o doble botón.
- Mantener el mensaje de error del API si igual falla.

**Archivos:** `src/app/pages/admin/admin.component.ts`, `admin.component.html`

---

### A2. Sustituir `alert()` en admin — **Baja**

**Problema:** Varios flujos usan `alert()` (bloquea UI, poco accesible).

**Qué hacer:**
- Mostrar mensajes en el template (banner/toast inline) como ya se hace con `error`, `configGuardada`, etc.
- Buscar: `alert(` en `admin.component.ts`.

**Archivos:** `src/app/pages/admin/admin.component.ts`, `admin.component.html`, `admin.component.scss`

---

### A3. Navbar móvil — **Baja**

**Problema:** Menú móvil sin cerrar con Escape; scroll del body no siempre bloqueado.

**Qué hacer:**
- `@HostListener` o listener en componente del navbar para `Escape`.
- Clase `overflow-hidden` en `body` mientras el menú esté abierto.

**Archivos:** buscar componente navbar/header en `src/app/shared/` o `src/app/`

---

### A4. Privacidad en premios históricos — **Baja**

**Problema:** Home / premios pueden mostrar nombre y cédula del ganador en sorteos pasados.

**Qué hacer:**
- Decidir regla: solo iniciales, solo nombre, u ocultar cédula en API pública.
- Ajustar `GET /api/sorteos/home` y componentes `premios`, `hero-rifa` si aplica.

**Archivos:** `server/index.js`, `src/app/pages/premios/`, `sorteos.service.ts`

---

### A5. SEO y redes sociales — **Baja**

**Problema:** Sin Open Graph / Twitter cards al compartir el enlace.

**Qué hacer:**
- Meta tags en `src/index.html` o servicio de meta dinámico.
- `og:title`, `og:description`, `og:image` (imagen del premio mayor activo sería ideal).

**Archivos:** `src/index.html`, opcional `src/app/app.component.ts`

---

### A6. README desactualizado — **Baja**

**Problema:** `README.md` menciona puertos 4200/3000 y flujo viejo (`cd server && npm start` por separado).

**Qué hacer:**
- Actualizar a: front **3015**, back **3012**, comando único `npm start dev`.
- Enlace a `docs/WOMPI-SANDBOX.md` y este archivo.

**Archivos:** `README.md`, revisar `docs/WOMPI-SANDBOX.md` (puertos)

---

## B. Pulido de código (backend)

### B1. Tipado `AdminStats` — **Baja**

**Problema:** La interfaz en `admin.service.ts` puede no coincidir al 100% con el API.

**Qué hacer:** Revisar `GET /api/admin/stats` y alinear interfaces TypeScript.

**Archivos:** `src/app/core/services/admin.service.ts`, `server/index.js`

---

### B2. Logs en producción — **Baja**

**Problema:** Varios `console.error('...', err)` loguean el objeto completo.

**Qué hacer:** En producción loguear solo `err?.message`; stack solo en desarrollo.

**Archivos:** `server/index.js`

---

### B3. Webhook Stripe (código muerto) — **Baja**

**Problema:** Si solo usan Wompi, la ruta `/api/webhooks/stripe` y deps en `package.json` raíz pueden confundir.

**Qué hacer:** Documentar que está deprecado o eliminar si confirmas que no se usará Stripe.

**Archivos:** `server/index.js`, `package.json` (raíz)

---

## C. Operación / producción (no es código, pero pendiente)

Marcar cuando esté hecho en el servidor real:

- [ ] **Deploy** front + back a `n1.voriamtechnologies.com`
- [ ] Precio **$20.000** en Admin → Configuración (`precio_stiker_cents: 2000000`)
- [ ] Cupos anticipados: `10,20,30,40,50,60,70,80,90,100` → Guardar
- [ ] WhatsApp y redes en `server/.env` producción
- [ ] **SMTP** con credenciales nuevas (correo desbloqueado)
- [ ] **Wompi producción** (`pub_prod_*`) cuando salgan de sandbox
- [ ] **Webhook Wompi** en dashboard → `https://<api>/api/webhooks/wompi`
- [ ] **Rotar contraseña Neon** (URL expuesta en chat)
- [ ] Sorteo / Premio Mayor activo el día del lanzamiento

---

## D. Pruebas manuales (QA de cierre)

- [ ] Compra simulada local → Verificar cédula → Admin ventas
- [ ] Cupos: al 10% vendido, premio al anticipado cuyo número coincida (ej. Anticipado 5)
- [ ] Límite 50 stikers por compra (intento 51 → error)
- [ ] Dos navegadores, mismo stiker → uno 409
- [ ] Post-deploy: monto manipulado en DevTools → HTTP 400
- [ ] Wompi sandbox con ngrok (opcional)

---

## E. Explícitamente fuera de alcance (por decisión del equipo)

No implementar salvo que cambien de opinión:

| Tema | Motivo |
|------|--------|
| Reescribir URLs de imágenes / SSL `inversionesjcb.online` | Dejar como está |
| CORS restrictivo (`ALLOWED_ORIGIN` obligatorio) | Dejar como está |
| Cambiar lógica del número bendecido (4 cifras en el par) | Ya definido y funcionando |

---

## F. Orden sugerido para mañana

1. **A1** — Confirmación doble Premio Mayor (rápido, mucho valor).
2. **A2** — Quitar `alert()` en admin.
3. **A6** — README (5 minutos).
4. **A4** o **A5** — según si priorizan privacidad o marketing al compartir links.
5. Resto cuando haya tiempo.

---

## G. Pantalla de planes SaaS — **Opción 1 elegida** (otro proyecto)

**Contexto:** Capturas con planes Básico / Pro / Negocio y botón global “Siguiente” abajo. **No está en `pages_jcb`**; implementar en el repo de esa app.

**Decisión:** Opción 1 — **CTA dentro de cada tarjeta**, sin “Siguiente” global.

### Qué cambiar

| Quitar | Poner |
|--------|--------|
| Botón “Siguiente” al final de la página | — |
| Botón “Siguiente” debajo de cada card (iPad) | — |
| — | Botón **“Elegir este plan”** (o “Continuar con Negocio”) **dentro** de cada tarjeta |
| — | Un toque = `selectPlan(id)` + navegar al siguiente paso del onboarding |

### Comportamiento

1. Usuario lee el plan en la tarjeta.
2. Pulsa **“Elegir este plan”** en esa misma tarjeta.
3. Se guarda el plan seleccionado (servicio/state/router).
4. Navegación directa al paso 2 (datos, pago, etc.) — **sin scroll** ni segundo clic.

### Texto del botón (sugerido)

- Genérico: `Elegir este plan`
- Con nombre: `Continuar con Negocio`
- Plan popular (Pro): `Elegir Pro` (badge “Más popular” se mantiene en el header)

### Estilo

- Botón full-width al pie de la tarjeta blanca (debajo del precio `$ X /mes`).
- Color del header del plan (azul Pro, morado Negocio) o un morado unificado de marca.
- `disabled` + spinner solo mientras carga la navegación/API.

### Móvil vs tablet

- **Móvil:** tarjetas en columna; cada una con su botón (no hace falta bajar hasta el final).
- **Tablet/desktop:** grid 2–3 columnas; **un botón por tarjeta**, no un “Siguiente” suelto bajo cada una en duplicado confuso — el botón va **dentro** del borde de la card.

### Implementación técnica (checklist)

- [ ] Eliminar componente/footer con `Siguiente` global.
- [ ] `@Output` o `(click)="onElegirPlan(plan)"` en cada card.
- [ ] State: `selectedPlanId` solo si hace falta en paso 2 (opcional si navegas con query `?plan=negocio`).
- [ ] Accesibilidad: `aria-label="Elegir plan Negocio por cien mil pesos al mes"`.
- [ ] Probar iPad 768px y móvil 375px.

### Archivos (rellenar cuando tengas el repo)

- `???/plan-card.component.*`
- `???/planes.component.*` o ruta de onboarding paso 1

---

## Referencia rápida — lo que ya está hecho (no repetir)

- Validación de monto checkout / Wompi / simular pago
- Anticipados por **cupos** (no orden fijo 1→10)
- Ocultar bendecidos en API pública; admin los ve
- Checkout atómico, stikers `reservado`, límite por compra
- Fecha `America/Bogota`, rate limit login/verificar
- Verificar stiker solo órdenes pagadas
- Texto “30 minutos” en Cómo participar
- Proxy local `npm start dev`
