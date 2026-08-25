/**
 * Envío de comprobantes por correo.
 *
 * Soporta tres transportes; se elige el primero que esté configurado:
 *   1. Resend  (RESEND_API_KEY) — API HTTP sobre el puerto 443
 *   2. Brevo   (BREVO_API_KEY)  — API HTTP sobre el puerto 443
 *   3. SMTP    (SMTP_HOST + SMTP_USER + SMTP_PASS) — 465/587
 *
 * Las APIs HTTP salen por 443, así que funcionan aunque el hosting filtre los
 * puertos de SMTP o el servidor de correo del proveedor no sea alcanzable.
 * Si no hay nada configurado, no hace nada (sin romper el servidor).
 */
import nodemailer from 'nodemailer';

/** Tiempo máximo de cualquier operación de envío: la petición HTTP nunca debe quedar colgada esperando al proveedor. */
const TIMEOUT_MS = 10000;

const resendApiKey = (process.env.RESEND_API_KEY || '').trim();
const brevoApiKey = (process.env.BREVO_API_KEY || '').trim();

const host = (process.env.SMTP_HOST || '').trim();
const portConfigurado = parseInt(process.env.SMTP_PORT || '465', 10);
const user = (process.env.SMTP_USER || '').trim();
const pass = (process.env.SMTP_PASS || '').replace(/^\s+|\s+$/g, '');
const smtpConfigurado = !!(host && user && pass);

/** Transporte activo: 'resend' | 'brevo' | 'smtp' | null. */
const provider = resendApiKey ? 'resend' : brevoApiKey ? 'brevo' : smtpConfigurado ? 'smtp' : null;
const configurado = provider !== null;

/** Dirección remitente. Con Resend/Brevo su dominio debe estar verificado en el proveedor. */
function remitenteEmail() {
  return (process.env.EMAIL_FROM || user || 'no_reply@inversionesjcb.online').trim().replace(/^.*<|>.*$/g, '');
}
function remitenteNombre() {
  const raw = (process.env.EMAIL_FROM || '').trim();
  const m = raw.match(/^\s*"?([^"<]+?)"?\s*</);
  return m ? m[1].trim() : 'Juego de la Ciudad Bonita';
}
/** Formato "Nombre <correo>" que espera nodemailer y la API de Resend. */
function remitente() {
  return `${remitenteNombre()} <${remitenteEmail()}>`;
}

// ----------------------------------------------------------------------------
// SMTP (transporte heredado)
// ----------------------------------------------------------------------------

/**
 * Puertos a intentar: el configurado primero y el alternativo después.
 * Algunos hostings bloquean la salida por 465 pero permiten 587 (o al revés).
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
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS
  });
}

let transporter = provider === 'smtp' ? crearTransporter(portConfigurado) : null;
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
function explicarErrorSmtp(e, port) {
  const raw = e?.response || e?.message || String(e);
  if (/\b535\b/.test(raw)) {
    return `535: el servidor rechazó usuario o contraseña (${user}). Revisa SMTP_USER y SMTP_PASS.`;
  }
  if (e?.code === 'ETIMEDOUT' || e?.code === 'ESOCKET' || /timeout/i.test(raw)) {
    // Un timeout no distingue entre "el hosting filtra el puerto" y "el host del
    // proveedor no responde": comprobar ambos antes de culpar al hosting.
    return `Sin respuesta de ${host}:${port} (timeout). Puede ser que el hosting filtre ese puerto o que el servidor de correo no sea alcanzable. Alternativa sin SMTP: define RESEND_API_KEY o BREVO_API_KEY (envío por API HTTPS).`;
  }
  if (e?.code === 'ECONNREFUSED') {
    return `Conexión rechazada por ${host}:${port}.`;
  }
  if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN') {
    return `No se pudo resolver el nombre ${host} (DNS). Revisa SMTP_HOST.`;
  }
  return raw;
}

async function intentarPuerto(port) {
  const t = port === portActivo && transporter ? transporter : crearTransporter(port);
  await withTimeout(t.verify(), TIMEOUT_MS + 1000, `Timeout al conectar con ${host}:${port}.`);
  return t;
}

async function verificarSmtpTransport() {
  const errores = [];
  for (const port of puertosAIntentar) {
    try {
      transporter = await intentarPuerto(port);
      portActivo = port;
      return { ok: true, error: null };
    } catch (e) {
      errores.push(explicarErrorSmtp(e, port));
      // Con credenciales rechazadas no tiene sentido probar el otro puerto.
      if (/\b535\b/.test(String(e?.response || e?.message))) break;
    }
  }
  return { ok: false, error: errores.join(' | ') };
}

// ----------------------------------------------------------------------------
// APIs HTTP (Resend / Brevo)
// ----------------------------------------------------------------------------

/** Lee el cuerpo de la respuesta como texto y extrae el mensaje de error del proveedor. */
async function mensajeDeError(res) {
  const texto = await res.text().catch(() => '');
  try {
    const json = JSON.parse(texto);
    return json.message || json.error?.message || json.code || texto || `HTTP ${res.status}`;
  } catch {
    return texto || `HTTP ${res.status}`;
  }
}

/** Traduce el fallo de una API HTTP a algo accionable. */
function explicarErrorHttp(e, url) {
  const raw = e?.message || String(e);
  if (e?.name === 'TimeoutError' || /timeout|abort/i.test(raw)) {
    return `Sin respuesta de ${url} (timeout).`;
  }
  if (e?.cause?.code === 'ENOTFOUND' || e?.cause?.code === 'EAI_AGAIN') {
    return `No se pudo resolver ${url} (DNS).`;
  }
  return raw;
}

const RESEND_URL = 'https://api.resend.com';
const BREVO_URL = 'https://api.brevo.com/v3';

/** Comprueba que la API key es válida, sin enviar correo. */
async function verificarResend() {
  try {
    const res = await fetch(`${RESEND_URL}/domains`, {
      headers: { Authorization: `Bearer ${resendApiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) {
      const detalle = await mensajeDeError(res);
      // Resend devuelve 400 (no 401) cuando la clave no es válida.
      if (res.status === 401 || res.status === 403 || /api key/i.test(detalle)) {
        return { ok: false, error: `Resend rechazó la API key (${res.status}): ${detalle}. Revisa RESEND_API_KEY.` };
      }
      return { ok: false, error: `Resend respondió ${res.status}: ${detalle}` };
    }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: explicarErrorHttp(e, 'api.resend.com') };
  }
}

async function enviarPorResend({ to, subject, html, text }) {
  const res = await fetch(`${RESEND_URL}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: remitente(), to: [to], subject, html, text }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) {
    const detalle = await mensajeDeError(res);
    // 403 con dominio sin verificar es el fallo más común al empezar con Resend.
    throw new Error(
      res.status === 403
        ? `Resend rechazó el envío (403): ${detalle}. Verifica el dominio de ${remitenteEmail()} en resend.com/domains.`
        : `Resend respondió ${res.status}: ${detalle}`
    );
  }
  const json = await res.json().catch(() => ({}));
  return json.id || null;
}

async function verificarBrevo() {
  try {
    const res = await fetch(`${BREVO_URL}/account`, {
      headers: { 'api-key': brevoApiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Brevo rechazó la API key (401). Revisa BREVO_API_KEY.' };
    }
    if (!res.ok) return { ok: false, error: `Brevo respondió ${res.status}: ${await mensajeDeError(res)}` };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: explicarErrorHttp(e, 'api.brevo.com') };
  }
}

async function enviarPorBrevo({ to, subject, html, text }) {
  const res = await fetch(`${BREVO_URL}/smtp/email`, {
    method: 'POST',
    headers: {
      'api-key': brevoApiKey,
      'Content-Type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({
      sender: { name: remitenteNombre(), email: remitenteEmail() },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`Brevo respondió ${res.status}: ${await mensajeDeError(res)}`);
  const json = await res.json().catch(() => ({}));
  return json.messageId || null;
}

// ----------------------------------------------------------------------------
// API pública del módulo (igual para los tres transportes)
// ----------------------------------------------------------------------------

/** Prueba conexión y credenciales (no envía correo). Cachea el resultado. */
export async function verificarSmtp() {
  if (!configurado) {
    lastCheck = {
      checkedAt: new Date().toISOString(),
      ok: false,
      error: 'Correo no configurado. Define RESEND_API_KEY, BREVO_API_KEY o SMTP_HOST/SMTP_USER/SMTP_PASS.'
    };
    return lastCheck;
  }
  if (checkEnCurso) return checkEnCurso;

  checkEnCurso = (async () => {
    let r;
    if (provider === 'resend') r = await verificarResend();
    else if (provider === 'brevo') r = await verificarBrevo();
    else r = await verificarSmtpTransport();
    lastCheck = { checkedAt: new Date().toISOString(), ok: r.ok, error: r.error };
    return lastCheck;
  })().finally(() => {
    checkEnCurso = null;
  });

  return checkEnCurso;
}

/** Envía un correo por el transporte activo. Lanza si falla. */
async function enviarCorreo({ to, subject, html, text }) {
  if (provider === 'resend') return enviarPorResend({ to, subject, html, text });
  if (provider === 'brevo') return enviarPorBrevo({ to, subject, html, text });
  const info = await withTimeout(
    transporter.sendMail({ from: remitente(), to, subject, html, text }),
    TIMEOUT_MS + 3000,
    'Timeout al enviar el correo.'
  );
  return info?.messageId || null;
}

/** Estado actual para diagnóstico (configuración + último chequeo, sin exponer credenciales). */
export function estadoSmtp() {
  const esHttp = provider === 'resend' || provider === 'brevo';
  return {
    configured: configurado,
    provider: provider || null,
    host: esHttp ? (provider === 'resend' ? 'api.resend.com' : 'api.brevo.com') : host || null,
    port: esHttp ? 443 : portActivo,
    portConfigurado: esHttp ? 443 : portConfigurado,
    user: esHttp ? remitenteEmail() : user || null,
    secure: esHttp ? 'HTTPS' : portActivo === 465 ? 'SSL' : 'STARTTLS',
    ...lastCheck
  };
}

/** Envía un correo real de prueba para confirmar que los comprobantes van a salir. */
export async function enviarCorreoPrueba(destino) {
  const to = (destino || '').trim() || (provider === 'smtp' ? user : remitenteEmail());
  if (!configurado) {
    return {
      ok: false,
      error: 'Correo no configurado. Define RESEND_API_KEY, BREVO_API_KEY o SMTP_HOST/SMTP_USER/SMTP_PASS.'
    };
  }
  const check = await verificarSmtp();
  if (!check.ok) return { ok: false, to, error: check.error };

  try {
    const messageId = await enviarCorreo({
      to,
      subject: 'Prueba de correo — Juego de la Ciudad Bonita',
      text:
        'Este es un correo de prueba enviado desde el panel de administración.\n' +
        'Si lo recibiste, los comprobantes de compra ya funcionan.'
    });
    return { ok: true, to, messageId, provider, port: estadoSmtp().port };
  } catch (e) {
    return { ok: false, to, error: e?.message || String(e) };
  }
}

if (configurado) {
  verificarSmtp().then((r) => {
    const s = estadoSmtp();
    if (r.ok) {
      console.log(`Correo listo vía ${provider}: ${s.user} (${s.host}:${s.port}, ${s.secure})`);
    } else {
      console.warn(`Correo no disponible vía ${provider} (${s.user} @ ${s.host}): ${r.error}`);
    }
  });
} else {
  console.warn('Correo no configurado: los comprobantes no se enviarán. Define RESEND_API_KEY, BREVO_API_KEY o SMTP_*.');
}

/** Envía el comprobante al cliente. Devuelve true si OK, false si no. */
export async function enviarComprobante(order, items = []) {
  if (!configurado) return false;
  const email = (order?.email || '').trim();
  if (!email) return false;

  const nombre = (order?.nombre || '').trim() || 'Cliente';
  const total = Number(order?.total_cents || 0) / 100;
  const moneda = ((order?.currency || 'cop') + '').toUpperCase();

  const numerosRows = items.length > 0
    ? items.map(i => `<tr><td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;font-size:16px;font-weight:600;color:#166534;">${String(i.numero_a ?? '')} - ${String(i.numero_b ?? '')}</td></tr>`).join('')
    : '<tr><td style="padding:10px 16px;color:#6b7280;">Sin detalle</td></tr>';

  const numerosTexto = items.length > 0
    ? items.map(i => `${String(i.numero_a ?? '')} - ${String(i.numero_b ?? '')}`).join('\n')
    : 'Sin detalle';

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

  const text =
    `¡Gracias por tu compra, ${nombre}!\n\n` +
    `Tu compra ha sido confirmada. Tus números:\n${numerosTexto}\n\n` +
    `Total pagado: ${total.toLocaleString('es-CO')} ${moneda}\n\n` +
    'Guarda este correo como comprobante. Verifica tu compra en "Verificar Stiker" con tu cédula.';

  try {
    await enviarCorreo({ to: email, subject: 'Comprobante - Juego de la Ciudad Bonita', html, text });
    console.log(`Comprobante enviado a ${email} vía ${provider}`);
    return true;
  } catch (err) {
    console.error('Error enviando comprobante:', err.message);
    return false;
  }
}
