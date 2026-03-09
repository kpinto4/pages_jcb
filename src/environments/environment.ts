/** URL base del API (opcional). Si no se define, se usa host + backendPort. */
export const environment = {
  production: false,
  /** Puerto del backend; debe coincidir con PORT en server/.env (p. ej. 3012). */
  backendPort: 3012,
  /** Si está definido, se usa esta URL completa para el API (útil si el backend está en otro dominio). */
  apiBaseUrl: undefined as string | undefined
};
