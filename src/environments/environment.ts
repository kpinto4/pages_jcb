export const environment = {
  production: false,
  /** Vacío = en local usa proxy (ng serve → backend :3012). Pon URL completa solo si quieres apuntar a producción. */
  paymentApiUrl: '',
  /** wa.me o api.whatsapp.com — vacío oculta la opción en el panel de contacto */
  whatsappDudasUrl: 'https://wa.me/573187936740',
  /** Enlace de invitación al grupo / comunidad */
  whatsappComunidadUrl: '',
  /** Redes (solo enlaces; vacío oculta el icono en el footer) */
  socialFacebookUrl: 'https://www.facebook.com/share/1LgDzheb4T/?mibextid=wwXIfr',
  socialInstagramUrl: 'https://www.instagram.com/juegoslaciudadbonita_',
  socialTiktokUrl: ''
};
