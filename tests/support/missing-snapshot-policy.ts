import { BINDING_PLATFORM } from "./visual-baseline-notice";

/**
 * ¿Hay que escribir la captura local que falta, en vez de dejar que la
 * corrida falle por su ausencia?
 *
 * En Linux nunca: ahí la línea base está versionada y la acepta una persona
 * (issue #58), así que una captura ausente significa que alguien no la
 * commiteó y eso tiene que fallar. En el resto de plataformas no hay línea
 * base versionada y la primera corrida de un checkout limpio no tiene con
 * qué comparar: 16 capturas recién creadas se leían como 16 regresiones
 * visuales (issue #96).
 *
 * Una captura que ya existe no se toca nunca, en ninguna plataforma. Ahí sí
 * hay con qué comparar, y si la página cambió la corrida debe fallar.
 */
export function shouldCreateMissingSnapshot(
  platform: NodeJS.Platform,
  snapshotExists: boolean,
): boolean {
  if (platform === BINDING_PLATFORM) {
    return false;
  }
  return !snapshotExists;
}
