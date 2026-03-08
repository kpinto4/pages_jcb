/**
 * Envío de comprobantes por correo.
 * Configura SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM en .env
 * Para Gmail: host=smtp.gmail.com, port=587, user=tu@gmail.com, pass=App Password (16 chars)
 */
import nodemailer from 'nodemailer';

const host = (process.env.SMTP_HOST || '').trim();
const port = parseInt(process.env.SMTP_PORT || '587', 10);
const user = (process.env.SMTP_USER || '').trim();
const pass = (process.env.SMTP_PASS || '').trim();
const fromAddr = (process.env.EMAIL_FROM || user || 'noreply@example.com').trim();

const configurado = !!(host && user && pass);

let transporter = null;
if (configurado) {
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

/**
 * Envía el comprobante de compra al cliente por correo.
 * @param {Object} order - Orden: { email, nombre, total_cents, currency }
 * @param {Array<{numero_a, numero_b}>} items - order_items
 * @returns {Promise<boolean>} true si se envió, false si no
 */
export async function enviarComprobante(order, items = []) {
  if (!configurado || !transporter) {
    console.warn('Email no configurado. Define SMTP_HOST, SMTP_USER, SMTP_PASS en server/.env para enviar comprobantes.');
    return false;
  }
  const email = (order.email || '').trim();
  if (!email) {
    console.warn('Enviar comprobante: la orden no tiene email.');
    return false;
  }

  const nombre = (order.nombre || '').trim() || 'Cliente';
  const total = Number(order.total_cents || 0) / 100;
  const moneda = (order.currency || 'cop').toUpperCase();
  const numerosHtml = items.length > 0
    ? items.map(i => `<li><strong>${i.numero_a} - ${i.numero_b}</strong></li>`).join('\n')
    : '<li>Sin detalle de números</li>';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; line-height: 1.5; color: #333; max-width: 480px; margin: 0 auto; padding: 1rem; }
  .titulo { color: #22c55e; font-size: 1.25rem; margin-bottom: 1rem; }
  .total { font-size: 1.2rem; font-weight: bold; margin-top: 1rem; }
  ul { padding-left: 1.25rem; }
</style></head>
<body>
  <p class="titulo">¡Gracias por tu compra, ${nombre}!</p>
  <p>Tu compra en Juego de la Ciudad Bonita ha sido confirmada.</p>
  <p><strong>Números comprados:</strong></p>
  <ul>${numerosHtml}</ul>
  <p class="total">Total pagado: ${total.toLocaleString('es-CO')} ${moneda}</p>
  <p style="color:#666;font-size:0.9rem;">Guarda este correo como comprobante. Puedes verificar tu compra en Verificar Stiker con tu cédula.</p>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: fromAddr,
      to: email,
      subject: 'Comprobante de compra - Juego de la Ciudad Bonita',
      html,
      text: `Gracias ${nombre}. Números: ${items.map(i => `${i.numero_a}-${i.numero_b}`).join(', ')}. Total: ${total} ${moneda}.`
    });
    console.log(`Comprobante enviado a ${email}`);
    return true;
  } catch (err) {
    console.error('Error enviando comprobante:', err.message);
    return false;
  }
}
