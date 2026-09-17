// Enmascara, dentro de la transcripción de una sesión del worker, los
// secretos que el propio workflow le inyecta.
//
// Hace falta porque la acción escribe ese archivo sin tocarlo: su función de
// redacción solo se aplica al resumen del job y a los comentarios, nunca al
// archivo en disco. Y el enmascarado de secretos de GitHub cubre el log, no
// los artefactos. En un repositorio público, un artefacto lo descarga
// cualquiera, así que basta un comando del worker que vuelque el entorno (o
// un `git remote -v`, que lleva el token en la URL) para publicar una
// credencial en texto plano.
//
// Uso: node --experimental-strip-types scripts/redact-transcript.ts <ruta> [VARIABLE...]

import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const REDACTED_PLACEHOLDER = "[REDACTADO]";

/** Por debajo de esto un valor no es un token: es una bandera, un número o una
 * credencial sin configurar. Reemplazarlo destrozaría la transcripción sin
 * proteger nada. */
export const MIN_SECRET_LENGTH = 12;

export function redactSecrets(
  content: string,
  secrets: readonly string[],
): string {
  return secrets
    .filter((secret) => secret.length >= MIN_SECRET_LENGTH)
    .reduce(
      (redacted, secret) => redacted.split(secret).join(REDACTED_PLACEHOLDER),
      content,
    );
}

function main(): void {
  const [transcriptPath, ...secretVariableNames] = process.argv.slice(2);
  if (!transcriptPath) {
    throw new Error(
      "uso: redact-transcript.ts <ruta de la transcripción> [VARIABLE...]",
    );
  }
  // El worker puede morir antes de escribirla. No hay nada que enmascarar, y
  // el paso que sube el artefacto ya avisa por su cuenta si no encuentra nada.
  if (!existsSync(transcriptPath)) {
    return;
  }

  const secrets = secretVariableNames
    .map((name) => process.env[name])
    .filter((value): value is string => value !== undefined && value !== "");

  const content = readFileSync(transcriptPath, "utf8");
  writeFileSync(transcriptPath, redactSecrets(content, secrets));
}

// Solo cuando se ejecuta como programa: los tests importan `redactSecrets`.
if (process.argv[1]?.endsWith("redact-transcript.ts")) {
  main();
}
