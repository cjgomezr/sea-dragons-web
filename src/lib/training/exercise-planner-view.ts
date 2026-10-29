import {
  EXERCISE_PHOTO_MAX_BYTES,
  type ExerciseCounts,
  type ExerciseSource,
  type ExerciseYoutube,
} from "./club-exercises";

/**
 * Lo que Planificar → Ejercicios (#910) decide antes de hablar con la API:
 * si una foto se puede subir, qué cifra lleva cada ficha y qué se escribe en
 * el campo de YouTube de uno abierto. El servidor lo vuelve a comprobar todo
 * (#903); esto sólo evita mandar lo que ya se sabe que no entra.
 */

/** Los de RF-10; el servidor mira los bytes, aquí basta el tipo del
 * navegador. */
const PHOTO_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type PhotoIssue = "photo_too_large" | "photo_type_unsupported";

export function checkExercisePhoto(file: {
  readonly size: number;
  readonly type: string;
}): PhotoIssue | null {
  if (!PHOTO_TYPES.has(file.type)) {
    return "photo_type_unsupported";
  }
  return file.size > EXERCISE_PHOTO_MAX_BYTES ? "photo_too_large" : null;
}

/** La cifra de una ficha: nulo es All. */
export function countOfSource(
  counts: ExerciseCounts,
  source: ExerciseSource | null,
): number {
  return source === null ? counts.library + counts.club : counts[source];
}

/** Lo que el planificador escribió: el enlace o la búsqueda, o nada. */
export function youtubeFieldText(youtube: ExerciseYoutube): string {
  if (youtube === null) {
    return "";
  }
  return youtube.kind === "link" ? youtube.url : youtube.query;
}
