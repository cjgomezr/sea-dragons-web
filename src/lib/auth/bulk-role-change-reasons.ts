/**
 * Por qué un socio no cambió en un cambio de rol en bloque (#552). Vive
 * aparte del dominio para que la pantalla lea la misma lista sin arrastrar
 * la bitácora ni los avisos al navegador.
 *
 * `not_audited` sí cambió en la base, pero su rastro no llegó a la bitácora,
 * y eso no se da por bueno.
 */
export const BULK_ROLE_CHANGE_FAILURE_REASONS = [
  "last_admin",
  "not_found",
  "forbidden",
  "not_audited",
  "unexpected",
] as const;

export type BulkRoleChangeFailureReason =
  (typeof BULK_ROLE_CHANGE_FAILURE_REASONS)[number];
