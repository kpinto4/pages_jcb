# Wompi (Colombia) y Sandbox

El proyecto usa **Wompi** como pasarela de pago en Colombia. El checkout redirige al Web Checkout de Wompi.

## Hacer pruebas ahora (local)

Con las variables de Wompi ya en `server/.env`:

1. **Reinicia el backend** (`npm start` en `server/`) para que cargue las claves. En consola debe aparecer: `Wompi activo (sandbox)`.
2. **Precio en COP:** En Admin → Configuración, define el precio por stiker en unidades (ej. `5000` = 5.000 COP). Wompi acepta montos bajos en COP.
3. **Probar pago:** Abre la app, elige stikers, completa datos (cédula obligatoria) y haz clic en **Pagar con tarjeta**. Serás redirigido al checkout de Wompi (sandbox).
4. **Tarjeta de prueba:** En el checkout usa `4242 4242 4242 4242`, fecha futura y CVC cualquiera (ej. 123).
5. **403 al entrar a la pasarela:** Si abres la app desde `localhost`, el backend envía a Wompi una URL de redirección permitida y tras pagar te quedas en la página de Wompi. Para que **tras pagar vuelvas directo a tu app**, usa ngrok (ver sección siguiente).

## Probar con túnel (redirección de vuelta a tu app en local)

Puedes usar **ngrok** (requiere cuenta y authtoken) o **LocalTunnel** (sin cuenta).

### Con LocalTunnel (sin registro)

En una terminal, con el frontend ya corriendo en el puerto 4200:

```bash
npx localtunnel --port 4200
```

Te dará una URL tipo `https://algún-nombre.loca.lt`. Ábrela en el navegador y haz la compra desde ahí; tras pagar en Wompi volverás a esa URL.

### Con ngrok (cuenta gratuita)

1. Regístrate en [dashboard.ngrok.com/signup](https://dashboard.ngrok.com/signup).
2. Copia tu authtoken en [dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken).
3. En PowerShell: `ngrok config add-authtoken TU_TOKEN`.
4. Ejecuta: `ngrok http 4200` y abre la URL https que te muestre.

## Probar con ngrok (redirección de vuelta a tu app en local) — pasos detallados

Así puedes probar el flujo completo en tu PC: pagas en Wompi y Wompi te redirige de vuelta a tu app.

1. **Tener la app y el backend corriendo**
   - En una terminal, en la carpeta del proyecto: `npm start` (frontend en http://localhost:4200).
   - En otra terminal, en `server/`: `npm start` (backend en http://localhost:3000).

2. **Instalar y ejecutar ngrok**
   - Entra en [ngrok.com](https://ngrok.com), crea una cuenta gratis y descarga ngrok (o usa `npx ngrok http 4200` si prefieres no instalar).
   - En una **tercera** terminal ejecuta:
     ```bash
     ngrok http 4200
     ```
     (Si usas npx: `npx ngrok http 4200`)

3. **Copiar la URL pública**
   - ngrok mostrará algo como: `Forwarding  https://abc123.ngrok-free.app -> http://localhost:4200`
   - Copia esa URL **https** (ej. `https://abc123.ngrok-free.app`).

4. **Abrir la app por esa URL**
   - En el navegador abre la URL de ngrok (no `localhost`). Verás la misma app pero con dirección pública.

5. **Configurar la URL de eventos en Wompi (importante)**  
   Para que la orden se marque como **pagada** en tu base de datos, Wompi debe poder avisar a tu backend. En local el backend está en `localhost:3000`, así que Wompi no puede llamarlo. Hay que exponer el backend con ngrok:
   - En **otra terminal** ejecuta: `ngrok http 3000` (backend).
   - Copia la URL **https** que te da (ej. `https://abc123.ngrok-free.app`).
   - Entra en el **dashboard de Wompi** → **Desarrolladores** (o Configuraciones avanzadas) → **URL de Eventos** (o "Seguimiento de transacciones").
   - Pega: `https://TU-URL-NGROK-DEL-BACKEND/api/webhooks/wompi`  
     (ej. `https://abc123.ngrok-free.app/api/webhooks/wompi`).
   - Guarda. Así, cuando el usuario pague, Wompi enviará el evento a tu backend y la orden pasará a "pagada".

6. **Hacer la compra desde ahí**
   - Abre la app por la URL de ngrok del **frontend** (puerto 4200). Elige stikers, completa datos, **Pagar con tarjeta**. Pagas en Wompi con `4242 4242 4242 4242` y Wompi te redirige de vuelta a tu app. Si configuraste la URL de eventos con el ngrok del backend, la orden se marcará como pagada y verás la pantalla de compra completada.

7. **Si ya pagaste y te quedaste en la página de Wompi:** Copia la "Referencia" que aparece (es un UUID). Abre tu app y en la barra de direcciones pon: `http://localhost:4200/comprar-stikers?success=true&session_id=REFERENCIA` (sustituye REFERENCIA por el valor). La app cargará y mostrará el estado de la compra.

8. **Confirmación del pago:** Wompi notifica al backend con un webhook. En **local**, tu máquina no es accesible desde internet, así que el webhook no llegará y la orden puede quedar "pendiente" hasta que el backend reciba el evento. Para que se marque como pagada en local:
   - Opción A: Usa [ngrok](https://ngrok.com): `ngrok http 3000`, copia la URL `https://xxx.ngrok.io` y en el dashboard de Wompi (Desarrolladores → URL de eventos) pon `https://xxx.ngrok.io/api/webhooks/wompi`. Guarda y vuelve a hacer una prueba de pago.
   - Opción B: En producción, configura la URL de eventos con tu dominio y el webhook funcionará sin túnel.

## Sandbox (pruebas sin dinero real)

1. **Registro y llaves**
   - Entra en [comercios.wompi.co](https://comercios.wompi.co/) y crea tu cuenta.
   - En **Desarrolladores** activa el **modo Sandbox** (barra roja arriba).
   - Copia:
     - **Llave pública** (empieza por `pub_test_` en sandbox).
     - **Secreto de integridad** (para la firma del checkout).
     - **Secreto de eventos** (para validar el webhook).

2. **Variables en `server/.env`**
   ```env
   WOMPI_PUBLIC_KEY=pub_test_xxxxxxxxxxxx
   WOMPI_INTEGRITY_SECRET=tu_secreto_integridad
   WOMPI_EVENTS_SECRET=tu_secreto_eventos
   ```

3. **URL de eventos (webhook)**
   - En el dashboard de Wompi, en **Desarrolladores > URL de eventos**, configura la URL de tu backend:
   - En local con túnel (ngrok, etc.): `https://tu-tunel.ngrok.io/api/webhooks/wompi`
   - En producción: `https://tudominio.com/api/webhooks/wompi`

4. **Datos de prueba en Sandbox**
   - **Tarjeta aprobada:** `4242 4242 4242 4242` (cualquier fecha futura, CVC 3 dígitos).
   - **Tarjeta declinada:** `4111 1111 1111 1111`.
   - **Nequi aprobado:** `3991111111`.
   - **Nequi declinado:** `3992222222`.
   - **PSE:** en el checkout elige “Banco que aprueba” o “Banco que rechaza”.

5. **Flujo**
   - El usuario elige stikers, datos y “Pagar”. Se redirige al checkout de Wompi.
   - Tras pagar (o rechazar), Wompi redirige a tu app con `?success=true&session_id=ORDER_ID`.
   - El backend recibe el evento `transaction.updated` en `/api/webhooks/wompi` y marca la orden como pagada.
   - La página de éxito puede hacer polling a `/api/session/:orderId` hasta que el webhook haya actualizado el estado.

## Producción

- En el dashboard de Wompi cambia a **Producción** y usa las llaves `pub_prod_*` y los secretos de producción.
- Configura la **URL de eventos** de producción.
- En `server/.env` sustituye las variables por las de producción.

El proyecto usa solo **Wompi** como pasarela. Sin Wompi en server/.env solo funciona “Simular pago”.
