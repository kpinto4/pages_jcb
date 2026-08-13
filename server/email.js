/**
 * Envío de comprobantes por correo.
 * Si SMTP no está configurado, no hace nada (sin romper el servidor).
 */
import nodemailer from 'nodemailer';

const host = (process.env.SMTP_HOST || '').trim();
const portConfigurado = parseInt(process.env.SMTP_PORT || '465', 10);
const user = (process.env.SMTP_USER || '').trim();
const pass = (process.env.SMTP_PASS || '').replace(/^\s+|\s+$/g, '');
const configurado = !!(host && user && pass);

/** Tiempo máximo de cualquier operación SMTP: la petición HTTP nunca debe quedar colgada esperando al proveedor. */
const SMTP_TIMEOUT_MS = 7000;

/**
 * Puertos a intentar: el configurado primero y el alternativo después.
 * Muchos VPS bloquean la salida por 465 pero permiten 587 (o al revés).
 */
const puertosAIntentar = portConfigurado === 465 ? [465, 587] : [portConfigurado, 465];

function crearTransporter(port) {
  const secure = port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user, pass },
    tls: { servername: host, minVersion: 'TLSv1.2' },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS
  });
}

/** Transporter activo: el del primer puerto que autenticó correctamente. */
let transporter = configurado ? crearTransporter(portConfigurado) : null;
let portActivo = portConfigurado;

/** Último resultado de la comprobación, para responder /api/admin/diagnostico sin volver a conectar. */
let lastCheck = { checkedAt: null, ok: null, error: null };
/** Comprobación en curso: evita lanzar varias conexiones simultáneas al pulsar el botón repetidas veces. */
let checkEnCurso = null;

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Traduce el fallo de nodemailer a algo accionable para quien administra el sitio. */
function explicarError(e, port) {
  const raw = e?.response || e?.message || String(e);
  if (/\b535\b/.test(raw)) {
    return `535: el servidor rechazó usuario o contraseña (${user}). Revisa SMTP_USER y SMTP_PASS.`;
  }
  if (e?.code === 'ETIMEDOUT' || e?.code === 'ESOCKET' || /timeout/i.test(raw)) {
    return `No se pudo conectar a ${host}:${port} (timeout). El servidor no tiene salida a ese puerto.`;
  }
  if (e?.code === 'ECONNREFUSED') {
    return `Conexión rechazada por ${host}:${port}.`;
  }
  return raw;
}

async function intentarPuerto(port) {
  const t = port === portActivo && transporter ? transporter : crearTransporter(port);
  await withTimeout(t.verify(), SMTP_TIMEOUT_MS + 1000, `Timeout al conectar con ${host}:${port}.`);
  return t;
}

/** Prueba conexión y autenticación (no envía correo). Cachea el resultado y fija el puerto que funcione. */
export async function verificarSmtp() {
  if (!configurado) {
    lastCheck = {
      checkedAt: new Date().toISOString(),
      ok: false,
      error: 'SMTP no configurado (faltan SMTP_HOST, SMTP_USER o SMTP_PASS)'
    };
    return lastCheck;
  }
  if (checkEnCurso) return checkEnCurso;

  checkEnCurso = (async () => {
    const errores = [];
    for (const port of puertosAIntentar) {
      try {
        transporter = await intentarPuerto(port);
        portActivo = port;
        lastCheck = { checkedAt: new Date().toISOString(), ok: true, error: null };
        return lastCheck;
      } catch (e) {
        errores.push(explicarError(e, port));
        // Con credenciales rechazadas no tiene sentido probar el otro puerto.
        if (/\b535\b/.test(String(e?.response || e?.message))) break;
      }
    }
    lastCheck = { checkedAt: new Date().toISOString(), ok: false, error: errores.join(' | ') };
    return lastCheck;
  })().finally(() => {
    checkEnCurso = null;
  });

  return checkEnCurso;
}

/** Estado actual para diagnóstico (configuración + último chequeo, sin exponer la contraseña). */
export function estadoSmtp() {
  return {
    configured: configurado,
    host: host || null,
    port: portActivo,
    portConfigurado,
    user: user || null,
    secure: portActivo === 465 ? 'SSL' : 'STARTTLS',
    ...lastCheck
  };
}

/** Envía un correo real de prueba para confirmar que los comprobantes van a salir. */
export async function enviarCorreoPrueba(destino) {
  const to = (destino || '').trim() || user;
  if (!configurado || !transporter) {
    return { ok: false, error: 'SMTP no configurado (faltan SMTP_HOST, SMTP_USER o SMTP_PASS)' };
  }
  const check = await verificarSmtp();
  if (!check.ok) return { ok: false, error: check.error };

  try {
    const info = await withTimeout(
      transporter.sendMail({
        from: remitente(),
        to,
        subject: 'Prueba de correo — Juego de la Ciudad Bonita',
        text:
          'Este es un correo de prueba enviado desde el panel de administración.\n' +
          'Si lo recibiste, los comprobantes de compra ya funcionan.'
      }),
      SMTP_TIMEOUT_MS + 3000,
      'Timeout al enviar el correo de prueba.'
    );
    return { ok: true, to, messageId: info?.messageId, port: portActivo };
  } catch (e) {
    return { ok: false, to, error: explicarError(e, portActivo) };
  }
}

function remitente() {
  const raw = (process.env.EMAIL_FROM || user || 'no_reply@inversionesjcb.online').trim();
  return raw.includes('<') ? raw : `Juego de la Ciudad Bonita <${raw}>`;
}

if (configurado) {
  verificarSmtp().then((r) => {
    if (r.ok) {
      console.log(`SMTP listo: ${user} @ ${host}:${portActivo} (${portActivo === 465 ? 'SSL' : 'STARTTLS'})`);
    } else {
      console.warn(`SMTP no disponible (${user} @ ${host}): ${r.error}`);
    }
  });
}

/** Envía el comprobante al cliente. Devuelve true si OK, false si no. */
export async function enviarComprobante(order, items = []) {
  if (!configurado || !transporter) return false;
  const email = (order?.email || '').trim();
  if (!email) return false;

  const nombre = (order?.nombre || '').trim() || 'Cliente';
  const total = Number(order?.total_cents || 0) / 100;
  const moneda = ((order?.currency || 'cop') + '').toUpperCase();
  const fromAddr = remitente();

  const numerosRows = items.length > 0
    ? items.map(i => `<tr><td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;font-size:16px;font-weight:600;color:#166534;">${String(i.numero_a ?? '')} - ${String(i.numero_b ?? '')}</td></tr>`).join('')
    : '<tr><td style="padding:10px 16px;color:#6b7280;">Sin detalle</td></tr>';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
        <tr>
          <td style="background:linear-gradient(135deg,#166534 0%,#22c55e 100%);padding:28px 24px;text-align:center;">
            <h1 style="margin:0;font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.02em;">🍀 Juego de la Ciudad Bonita</h1>
            <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.9);">Comprobante de compra</p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 24px;">
            <p style="margin:0 0 20px;font-size:16px;color:#374151;line-height:1.5;">¡Gracias por tu compra, <strong>${nombre}</strong>!</p>
            <p style="margin:0 0 16px;font-size:14px;color:#6b7280;">Tu compra ha sido confirmada. Aquí están tus números:</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:24px;">
              ${numerosRows}
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#ecfdf5;border-radius:8px;border:1px solid #a7f3d0;">
              <tr>
                <td style="padding:16px 20px;">
                  <span style="font-size:14px;color:#166534;">Total pagado</span><br>
                  <span style="font-size:24px;font-weight:700;color:#166534;">${total.toLocaleString('es-CO')} ${moneda}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center;">
            Guarda este correo como comprobante. Verifica tu compra en <strong>Verificar Stiker</strong> con tu cédula.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: fromAddr,
      to: email,
      subject: 'Comprobante - Juego de la Ciudad Bonita',
      html
    });
    console.log('Comprobante enviado a', email);
    return true;
  } catch (err) {
    console.error('Error enviando comprobante:', err.message);
    return false;
  }
}
