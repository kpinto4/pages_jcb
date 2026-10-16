/**
 * WhatsApp Cloud API (Meta) para el CRM: plantillas aprobadas y envío de recordatorios a clientes.
 *
 * Variables en server/.env:
 *   WHATSAPP_TOKEN            token del usuario del sistema (permisos whatsapp_business_management y _messaging)
 *   WHATSAPP_PHONE_NUMBER_ID  identificador del número que envía (no es el número de teléfono)
 *   WHATSAPP_WABA_ID          cuenta de WhatsApp Business donde están las plantillas
 *   WHATSAPP_API_VERSION      opcional, por defecto v23.0
 *
 * WhatsApp solo deja escribir primero a un cliente con una plantilla aprobada por Meta; el texto libre
 * solo vale dentro de las 24 h siguientes a un mensaje del cliente.
 */

// Se leen al usarse, no al cargar el módulo: index.js importa este archivo antes de ejecutar
// dotenv.config(), así que a esa altura process.env aún no tiene las variables de server/.env.
const env = (name, fallback = '') => (process.env[name] || fallback).trim();
const token = () => env('WHATSAPP_TOKEN');
const phoneNumberId = () => env('WHATSAPP_PHONE_NUMBER_ID');
const wabaId = () => env('WHATSAPP_WABA_ID');

export function whatsappConfigurado() {
  return !!(token() && phoneNumberId() && wabaId());
}

/** Qué variables faltan, para mostrarlo en el panel en vez de un error genérico. */
export function variablesFaltantes() {
  const faltan = [];
  if (!token()) faltan.push('WHATSAPP_TOKEN');
  if (!phoneNumberId()) faltan.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!wabaId()) faltan.push('WHATSAPP_WABA_ID');
  return faltan;
}

async function graph(pathAndQuery, { method = 'GET', body } = {}) {
  const res = await fetch(`https://graph.facebook.com/${env('WHATSAPP_API_VERSION', 'v23.0')}/${pathAndQuery}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    const err = new Error(explicarError(data?.error) || `Meta respondió ${res.status}`);
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

/** Traduce los errores de Meta más comunes a algo que el admin pueda resolver. */
function explicarError(e) {
  if (!e) return '';
  const detalle = e.error_user_msg || e.error_data?.details || e.message || '';
  if (e.error_subcode === 2388339) {
    return 'La app de Meta no tiene el producto WhatsApp y no puede crear plantillas: créala en WhatsApp Manager → Plantillas de mensajes.';
  }
  switch (e.code) {
    case 190: return 'El token de WhatsApp venció o no es válido. Genera uno nuevo y actualiza WHATSAPP_TOKEN.';
    case 100: return `Parámetro inválido: ${detalle}`;
    case 131026: return 'El número no tiene WhatsApp o no puede recibir el mensaje.';
    case 131047: return 'Pasaron más de 24 h desde el último mensaje del cliente: solo se le puede escribir con plantilla.';
    case 131048: return 'Meta frenó los envíos por baja calidad (muchos bloqueos o reportes). Espera y revisa el contenido.';
    case 131056: return 'Demasiados mensajes seguidos al mismo número. Espera un momento.';
    case 132000: return 'La cantidad de variables no coincide con la plantilla.';
    case 132001: return 'La plantilla no existe en ese idioma o aún no está aprobada.';
    case 133010: return 'El número de WhatsApp no está registrado en la API.';
    default: return detalle ? `${detalle} (código ${e.code})` : `Error de Meta (código ${e.code})`;
  }
}

/** Datos del número que envía: nombre verificado, estado de conexión, calidad y límite diario. */
export async function estadoNumero() {
  return graph(`${phoneNumberId()}?fields=display_phone_number,verified_name,status,quality_rating,messaging_limit_tier`);
}

/**
 * Fecha de vencimiento del token (ISO) o null si no vence (token permanente de usuario del sistema).
 * Un token de usuario ampliado dura 60 días y hay que renovarlo a mano.
 */
export async function vencimientoToken() {
  const data = await graph(`debug_token?input_token=${encodeURIComponent(token())}`);
  const exp = Number(data?.data?.expires_at || 0);
  return exp > 0 ? new Date(exp * 1000).toISOString() : null;
}

/** Nombres de las variables del cuerpo de la plantilla: ['1','2'] (posicionales) o ['nombre', ...] (con nombre). */
function variablesDelCuerpo(texto) {
  const vistas = [];
  for (const m of String(texto || '').matchAll(/\{\{\s*([\w]+)\s*\}\}/g)) {
    if (!vistas.includes(m[1])) vistas.push(m[1]);
  }
  return vistas;
}

/** Todas las plantillas de la cuenta (aprobadas, en revisión, rechazadas), con el texto y las variables del cuerpo. */
export async function plantillas() {
  const data = await graph(`${wabaId()}/message_templates?fields=name,language,status,category,parameter_format,components,rejected_reason&limit=100`);
  return (data.data || []).map((t) => {
    const body = (t.components || []).find((c) => c.type === 'BODY');
    return {
      nombre: t.name,
      idioma: t.language,
      categoria: t.category,
      estado: t.status,
      motivoRechazo: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
      formato: t.parameter_format === 'NAMED' ? 'NAMED' : 'POSITIONAL',
      texto: body?.text || '',
      variables: variablesDelCuerpo(body?.text)
    };
  });
}

export async function plantillasAprobadas() {
  return (await plantillas()).filter((p) => p.estado === 'APPROVED');
}

/**
 * Envía una plantilla nueva a revisión de Meta. `ejemplos` es un valor de muestra por cada {{n}} del texto
 * (Meta los exige para revisar). `boton` es opcional: { texto, url }.
 */
export async function crearPlantilla({ nombre, categoria, texto, ejemplos, pie, boton }) {
  const components = [{
    type: 'BODY',
    text: texto,
    ...(ejemplos.length ? { example: { body_text: [ejemplos] } } : {})
  }];
  if (pie) components.push({ type: 'FOOTER', text: pie });
  if (boton?.texto && boton?.url) {
    components.push({ type: 'BUTTONS', buttons: [{ type: 'URL', text: boton.texto, url: boton.url }] });
  }
  return graph(`${wabaId()}/message_templates`, {
    method: 'POST',
    body: { name: nombre, language: 'es', category: categoria, components }
  });
}

export { variablesDelCuerpo };

/**
 * Número en formato internacional sin '+' (573001234567). Los celulares de Colombia vienen de la
 * compra con 10 dígitos empezando por 3; se les antepone 57. Devuelve null si no parece válido.
 */
export function normalizarTelefono(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('3')) return `57${d}`;
  if (d.length === 12 && d.startsWith('573')) return d;
  return null;
}

/**
 * Envía una plantilla. `valores` va en el orden de `plantilla.variables`.
 * Devuelve el id del mensaje que asigna Meta (wamid...).
 */
export async function enviarPlantilla(telefono, plantilla, valores) {
  const parameters = plantilla.variables.map((nombre, i) => ({
    type: 'text',
    text: String(valores[i] ?? '').trim() || '-',
    ...(plantilla.formato === 'NAMED' ? { parameter_name: nombre } : {})
  }));
  const data = await graph(`${phoneNumberId()}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      to: telefono,
      type: 'template',
      template: {
        name: plantilla.nombre,
        language: { code: plantilla.idioma },
        ...(parameters.length ? { components: [{ type: 'body', parameters }] } : {})
      }
    }
  });
  return data?.messages?.[0]?.id || null;
}
