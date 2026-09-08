/** Carga `.env.local` en `process.env` si existe. Solo el archivo ausente es
 * el caso esperado (p. ej. en la nube sin secrets configurados): cualquier
 * otro error (permisos, sintaxis inválida) se relanza, porque silenciarlo lo
 * haría ver igual que "faltan credenciales" y produciría un salto por una
 * razón completamente distinta, indistinguible de una corrida a otra. */
export function loadLocalEnvFile(): void {
  try {
    process.loadEnvFile(".env.local");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
