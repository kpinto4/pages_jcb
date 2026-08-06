export const environment = {
  production: false,
  /** Vacío = en local usa proxy (ng serve → backend :3012). Pon URL completa solo si quieres apuntar a producción. */
  paymentApiUrl: '',
  /** wa.me o api.whatsapp.com — vacío oculta la opción en el panel de contacto */
  whatsappDudasUrl: '',
  /** Enlace de invitación al grupo / comunidad */
  whatsappComunidadUrl: '',
  /** Redes (solo enlaces; vacío oculta el icono en el footer) */
  socialFacebookUrl: '',
  socialInstagramUrl: '',
  socialTiktokUrl: ''
};
