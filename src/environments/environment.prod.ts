export const environment = {
  production: true,
  /**
   * URL base del backend cuando el front está en otro dominio (ej. GitHub Pages vs Render).
   * Si lo defines (ej. https://tu-api.onrender.com), las imágenes y el API se cargarán desde ahí
   * y se evita que el navegador bloquee las imágenes por dominio distinto.
   * Si front y API están en el mismo origen, no hace falta (se usa origin + '/api').
   */
  paymentApiUrl: '' // ej. 'https://tu-backend.onrender.com'
};
