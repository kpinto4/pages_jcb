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
  const fromAddr = (process.env.EMAIL_FROM || user || 'noreply@example.com').trim();

  const numerosHtml = items.length > 0
    ? items.map(i => `<li><strong>${String(i.numero_a ?? '')} - ${String(i.numero_b ?? '')}</strong></li>`).join('\n')
    : '<li>Sin detalle</li>';

  const html = `<!DOCTYPE html><html><body>
    <p>Gracias por tu compra, ${nombre}.</p>
    <p><strong>Números comprados:</strong></p><ul>${numerosHtml}</ul>
    <p><strong>Total:</strong> ${total.toLocaleString('es-CO')} ${moneda}</p>
  </body></html>`;

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
