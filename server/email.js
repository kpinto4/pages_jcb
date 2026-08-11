/**
 * Envío de comprobantes por correo.
 * Si SMTP no está configurado, no hace nada (sin romper el servidor).
 */
import nodemailer from 'nodemailer';

const host = (process.env.SMTP_HOST || '').trim();
const port = parseInt(process.env.SMTP_PORT || '587', 10);
const user = (process.env.SMTP_USER || '').trim();
const pass = (process.env.SMTP_PASS || '').trim();
const configurado = !!(host && user && pass);

let transporter = null;
if (configurado) {
  try {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
  } catch (e) {
    console.warn('Email: error configurando SMTP:', e.message);
  }
}

/** Envía el comprobante al cliente. Devuelve true si OK, false si no. */
export async function enviarComprobante(order, items = []) {
  if (!configurado || !transporter) return false;
  const email = (order?.email || '').trim();
  if (!email) return false;

  const nombre = (order?.nombre || '').trim() || 'Cliente';
  const total = Number(order?.total_cents || 0) / 100;
  const moneda = ((order?.currency || 'cop') + '').toUpperCase();
  const fromAddr = (process.env.EMAIL_FROM || user || 'no_reply@inversionesjcb.online').trim();

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
