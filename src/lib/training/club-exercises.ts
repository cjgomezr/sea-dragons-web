import {
  type AuditAction,
  type AuditActor,
  type AuditLogWriter,
  recordAuditEvent,
} from "@/lib/audit/audit-log";
import type { RoleRequestGateways } from "@/lib/auth/role-request";
import { detectFileType } from "@/lib/files/file-type";
import { findTrainingPlanner } from "./training-planner";

/**
 * Los ejercicios en Planificar (#903, RF-10 y D13 del PRD de E35): buscar en
 * la biblioteca y en los del club, y crear, editar y borrar los del club. La
 * biblioteca (D12) sólo se lee: la carga su script.
 *
 * Un ejercicio del club tiene nombre, consejos (uno por línea), un enlace o
 * una búsqueda de YouTube, y hasta dos fotos, inicio y fin. Las fotos van al
 * bucket público de `0083` en `club/{club_id}/{exercise_id}/{0|1}.{ext}`.
 * Que el nombre no repita otro de la biblioteca o del club, sin mayúsculas ni
 * acentos, lo decide la base (`0084`).
 */

/** El límite de `training_exercises_name_length` en `0083`. */
export const EXERCISE_NAME_MAX_LENGTH = 80;
/** 5 MB por foto (RF-10), lo mismo que el bucket. */
export const EXERCISE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** Los resultados de una búsqueda (#903). */
export const EXERCISE_SEARCH_LIMIT = 20;
/** Lo que cabe en una búsqueda: el nombre más largo posible. */
export const EXERCISE_QUERY_MAX_LENGTH = EXERCISE_NAME_MAX_LENGTH;
/** Topes de la base no hay; éstos sólo impiden un ejercicio de megas. */
export const EXERCISE_TIPS_MAX = 20;
export const EXERCISE_TIP_MAX_LENGTH = 300;
export const EXERCISE_YOUTUBE_MAX_LENGTH = 300;

/** El texto que hace de un YouTube un enlace (D13). Cualquier otro, también
 * `http://` o `javascript:`, es una búsqueda, como en la vista del socio. */
const YOUTUBE_LINK_PREFIX = "https://";

const EXERCISE_ENTITY_TYPE = "training_exercise";
const CLUB_PHOTOS_PREFIX = "club";
const TIP_SEPARATOR = /\r?\n/;

export const EXERCISE_PHOTO_SLOTS = ["start", "end"] as const;

export type ExercisePhotoSlot = (typeof EXERCISE_PHOTO_SLOTS)[number];

/** La foto de inicio es la 0 y la de fin la 1 en la ruta de Storage. */
const SLOT_FILE_INDEX: Readonly<Record<ExercisePhotoSlot, number>> = {
  start: 0,
  end: 1,
};

type PhotoType = "image/jpeg" | "image/png" | "image/webp";

const PHOTO_EXTENSIONS: Readonly<Record<PhotoType, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type ExerciseSource = "library" | "club";

/** Nulo: no hay nada propio y la vista del socio busca el nombre. */
export type ExerciseYoutube =
  | { readonly kind: "link"; readonly url: string }
  | { readonly kind: "search"; readonly query: string }
  | null;

/** Una fila de `training_exercises`; `clubId` nulo es de la biblioteca. */
export type ExerciseRecord = {
  readonly id: string;
  readonly clubId: string | null;
  readonly name: string;
  readonly tips: readonly string[];
  readonly youtube: string | null;
  readonly imageStartPath: string | null;
  readonly imageEndPath: string | null;
};

/** Lo que se escribe de un ejercicio del club. */
export type ClubExerciseRow = ExerciseRecord & { readonly clubId: string };

type PhotoUrls = Readonly<Record<ExercisePhotoSlot, string | null>>;

export type ManagedExercise = {
  readonly id: string;
  readonly name: string;
  readonly source: ExerciseSource;
  readonly tips: readonly string[];
  readonly youtube: ExerciseYoutube;
  /** La foto de inicio, o nula: la pantalla pinta el icono genérico. */
  readonly thumbnailUrl: string | null;
  readonly photoUrls: PhotoUrls;
  /** Los nombres de las rutinas del club que lo usan. */
  readonly routines: readonly string[];
};

export type ManagedExercises = {
  readonly exercises: readonly ManagedExercise[];
};

/** Lo que llega del formulario, sin recortar. */
export type ClubExerciseFields = {
  readonly name: string;
  /** Un consejo por línea. */
  readonly tips: string;
  readonly youtube: string;
};

export type PhotoChange =
  | { readonly kind: "keep" }
  | { readonly kind: "remove" }
  | { readonly kind: "replace"; readonly bytes: Uint8Array };

export type PhotoChanges = Readonly<Record<ExercisePhotoSlot, PhotoChange>>;

/** `not_found` sólo al editar: otro lo borró entretanto. */
export type ExerciseWriteResult =
  | { readonly kind: "saved" }
  | { readonly kind: "name_taken" }
  | { readonly kind: "not_found" };

/** `in_use` es la clave de una fila de rutina, que no tiene `on delete`. */
export type ExerciseDeleteResult =
  { readonly kind: "deleted" } | { readonly kind: "in_use" };

export type ClubExercisesGateway = {
  /** En el orden de la base: primero los que empiezan por `text`. */
  searchExercises(query: {
    readonly clubId: string;
    readonly text: string;
    readonly limit: number;
  }): Promise<readonly ExerciseRecord[]>;
  findExercise(exerciseId: string): Promise<ExerciseRecord | null>;
  isNameTaken(query: {
    readonly clubId: string;
    readonly name: string;
    readonly exceptId: string | null;
  }): Promise<boolean>;
  listRoutineNames(query: {
    readonly clubId: string;
    readonly exerciseIds: readonly string[];
  }): Promise<ReadonlyMap<string, readonly string[]>>;
  insertExercise(row: ClubExerciseRow): Promise<ExerciseWriteResult>;
  updateExercise(row: ClubExerciseRow): Promise<ExerciseWriteResult>;
  deleteExercise(target: {
    readonly clubId: string;
    readonly exerciseId: string;
  }): Promise<ExerciseDeleteResult>;
};

export type ExercisePhotosGateway = {
  /** Sustituye lo que hubiera en la misma ruta. */
  upload(photo: {
    readonly storagePath: string;
    readonly bytes: Uint8Array;
    readonly contentType: string;
  }): Promise<void>;
  remove(storagePaths: readonly string[]): Promise<void>;
  publicUrl(storagePath: string): string;
};

export type ClubExercisesGateways = {
  readonly members: RoleRequestGateways["members"];
  readonly exercises: ClubExercisesGateway;
  readonly photos: ExercisePhotosGateway;
  readonly audit: AuditLogWriter;
  newExerciseId(): string;
};

export type ExerciseIssueCode =
  | "name_required"
  | "name_too_long"
  | "too_many_tips"
  | "tip_too_long"
  | "youtube_too_long"
  | "query_too_long"
  | "photo_too_large"
  | "photo_type_unsupported";

export class ExerciseValidationError extends Error {
  readonly code: ExerciseIssueCode;

  constructor(code: ExerciseIssueCode) {
    super(`El ejercicio no vale: ${code}.`);
    this.name = "ExerciseValidationError";
    this.code = code;
  }
}

/** El texto es el de la pantalla (RF-10): la API lo devuelve tal cual. */
export class ExerciseNameTakenError extends Error {
  constructor() {
    super("There is already an exercise with that name.");
    this.name = "ExerciseNameTakenError";
  }
}

export class ExerciseNotFoundError extends Error {
  constructor() {
    super("No existe ese ejercicio en tu club.");
    this.name = "ExerciseNotFoundError";
  }
}

export class LibraryExerciseReadOnlyError extends Error {
  constructor() {
    super("Los ejercicios de la biblioteca no se cambian ni se borran.");
    this.name = "LibraryExerciseReadOnlyError";
  }
}

export class ExerciseInUseError extends Error {
  constructor() {
    super("El ejercicio está en una rutina: quítalo de ella antes.");
    this.name = "ExerciseInUseError";
  }
}

type ValidFields = {
  readonly name: string;
  readonly tips: readonly string[];
  readonly youtube: string | null;
};

type ValidPhoto = {
  readonly bytes: Uint8Array;
  readonly contentType: PhotoType;
};

type ValidPhotoChange =
  | { readonly kind: "keep" }
  | { readonly kind: "remove" }
  | { readonly kind: "replace"; readonly photo: ValidPhoto };

type ValidPhotoChanges = Readonly<Record<ExercisePhotoSlot, ValidPhotoChange>>;

type StoredPhotoPaths = Readonly<Record<ExercisePhotoSlot, string | null>>;

/** Como lo lee la vista del socio (`training-plan.ts`). */
export function classifyYoutube(stored: string | null): ExerciseYoutube {
  if (stored === null) {
    return null;
  }
  return stored.startsWith(YOUTUBE_LINK_PREFIX)
    ? { kind: "link", url: stored }
    : { kind: "search", query: stored };
}

/** Como `char_length` de Postgres: un emoji es un carácter, no dos. */
function countCharacters(text: string): number {
  return [...text].length;
}

function validName(raw: string): string {
  const name = raw.trim();
  if (name === "") {
    throw new ExerciseValidationError("name_required");
  }
  if (countCharacters(name) > EXERCISE_NAME_MAX_LENGTH) {
    throw new ExerciseValidationError("name_too_long");
  }
  return name;
}

/** Uno por línea, recortados, sin las líneas en blanco. */
function validTips(raw: string): readonly string[] {
  const tips = raw
    .split(TIP_SEPARATOR)
    .map((tip) => tip.trim())
    .filter((tip) => tip !== "");
  if (tips.length > EXERCISE_TIPS_MAX) {
    throw new ExerciseValidationError("too_many_tips");
  }
  if (tips.some((tip) => countCharacters(tip) > EXERCISE_TIP_MAX_LENGTH)) {
    throw new ExerciseValidationError("tip_too_long");
  }
  return tips;
}

function validYoutube(raw: string): string | null {
  const youtube = raw.trim();
  if (countCharacters(youtube) > EXERCISE_YOUTUBE_MAX_LENGTH) {
    throw new ExerciseValidationError("youtube_too_long");
  }
  return youtube === "" ? null : youtube;
}

function validFields(fields: ClubExerciseFields): ValidFields {
  return {
    name: validName(fields.name),
    tips: validTips(fields.tips),
    youtube: validYoutube(fields.youtube),
  };
}

function isPhotoType(type: string | null): type is PhotoType {
  return type !== null && Object.hasOwn(PHOTO_EXTENSIONS, type);
}

/** El tipo lo dicen los bytes, no el nombre ni la cabecera de quien sube. */
function validPhoto(bytes: Uint8Array): ValidPhoto {
  if (bytes.length > EXERCISE_PHOTO_MAX_BYTES) {
    throw new ExerciseValidationError("photo_too_large");
  }
  const contentType = detectFileType(bytes);
  if (!isPhotoType(contentType)) {
    throw new ExerciseValidationError("photo_type_unsupported");
  }
  return { bytes, contentType };
}

function validPhotoChanges(changes: PhotoChanges): ValidPhotoChanges {
  const validChange = (change: PhotoChange): ValidPhotoChange =>
    change.kind === "replace"
      ? { kind: "replace", photo: validPhoto(change.bytes) }
      : change;
  return { start: validChange(changes.start), end: validChange(changes.end) };
}

function photoPath(
  target: { readonly clubId: string; readonly exerciseId: string },
  slot: ExercisePhotoSlot,
  photo: ValidPhoto,
): string {
  const extension = PHOTO_EXTENSIONS[photo.contentType];
  return `${CLUB_PHOTOS_PREFIX}/${target.clubId}/${target.exerciseId}/${SLOT_FILE_INDEX[slot]}.${extension}`;
}

function storedPhotoPaths(exercise: ExerciseRecord): StoredPhotoPaths {
  return { start: exercise.imageStartPath, end: exercise.imageEndPath };
}

/** Sube las fotos nuevas y devuelve dónde queda cada una. Si una subida
 * falla, borra las que ya subió antes de propagar el error. */
async function storePhotos(
  gateways: ClubExercisesGateways,
  input: {
    readonly target: { readonly clubId: string; readonly exerciseId: string };
    readonly changes: ValidPhotoChanges;
    readonly previous: StoredPhotoPaths;
  },
): Promise<{ readonly paths: StoredPhotoPaths; readonly uploaded: string[] }> {
  const uploaded: string[] = [];
  const paths: Record<ExercisePhotoSlot, string | null> = { ...input.previous };
  try {
    for (const slot of EXERCISE_PHOTO_SLOTS) {
      const change = input.changes[slot];
      if (change.kind === "remove") {
        paths[slot] = null;
      }
      if (change.kind === "replace") {
        const storagePath = photoPath(input.target, slot, change.photo);
        await gateways.photos.upload({ storagePath, ...change.photo });
        uploaded.push(storagePath);
        paths[slot] = storagePath;
      }
    }
  } catch (error) {
    await removePhotosQuietly(gateways, uploaded);
    throw error;
  }
  return { paths, uploaded };
}

/** Lo que queda en Storage sin que nada lo use. El cambio ya está guardado,
 * así que un fallo aquí se registra en vez de deshacerlo. */
async function removePhotosQuietly(
  gateways: ClubExercisesGateways,
  storagePaths: readonly string[],
): Promise<void> {
  if (storagePaths.length === 0) {
    return;
  }
  try {
    await gateways.photos.remove(storagePaths);
  } catch (cleanupError) {
    console.error(
      `[training-exercises] quedaron sin borrar las fotos ${storagePaths.join(", ")}`,
      cleanupError,
    );
  }
}

function toManagedExercise(
  gateways: ClubExercisesGateways,
  exercise: ExerciseRecord,
  routines: readonly string[],
): ManagedExercise {
  const urlOf = (path: string | null): string | null =>
    path === null ? null : gateways.photos.publicUrl(path);
  const photoUrls = {
    start: urlOf(exercise.imageStartPath),
    end: urlOf(exercise.imageEndPath),
  };
  return {
    id: exercise.id,
    name: exercise.name,
    source: exercise.clubId === null ? "library" : "club",
    tips: exercise.tips,
    youtube: classifyYoutube(exercise.youtube),
    thumbnailUrl: photoUrls.start,
    photoUrls,
    routines,
  };
}

async function describeExercises(
  gateways: ClubExercisesGateways,
  clubId: string,
  exercises: readonly ExerciseRecord[],
): Promise<readonly ManagedExercise[]> {
  const routinesById = await gateways.exercises.listRoutineNames({
    clubId,
    exerciseIds: exercises.map((exercise) => exercise.id),
  });
  return exercises.map((exercise) =>
    toManagedExercise(gateways, exercise, routinesById.get(exercise.id) ?? []),
  );
}

async function describeExercise(
  gateways: ClubExercisesGateways,
  exercise: ClubExerciseRow,
): Promise<ManagedExercise> {
  const [described] = await describeExercises(gateways, exercise.clubId, [
    exercise,
  ]);
  if (described === undefined) {
    throw new Error(`No se pudo describir el ejercicio ${exercise.id}.`);
  }
  return described;
}

function recordExerciseEvent(
  gateways: ClubExercisesGateways,
  event: {
    readonly actor: AuditActor;
    readonly action: AuditAction;
    readonly exerciseId: string;
  },
): Promise<void> {
  return recordAuditEvent(gateways.audit, {
    actor: event.actor,
    clubId: event.actor.clubId,
    action: event.action,
    entityType: EXERCISE_ENTITY_TYPE,
    entityId: event.exerciseId,
    result: "success",
  });
}

async function ensureNameFree(
  gateways: ClubExercisesGateways,
  query: {
    readonly clubId: string;
    readonly name: string;
    readonly exceptId: string | null;
  },
): Promise<void> {
  if (await gateways.exercises.isNameTaken(query)) {
    throw new ExerciseNameTakenError();
  }
}

/** Uno del club de quien llama: el de otro club no existe, y uno de la
 * biblioteca no se toca. */
async function findOwnClubExercise(
  gateways: ClubExercisesGateways,
  request: { readonly clubId: string; readonly exerciseId: string },
): Promise<ClubExerciseRow> {
  const exercise = await gateways.exercises.findExercise(request.exerciseId);
  if (exercise === null) {
    throw new ExerciseNotFoundError();
  }
  const { clubId } = exercise;
  if (clubId === null) {
    throw new LibraryExerciseReadOnlyError();
  }
  if (clubId !== request.clubId) {
    throw new ExerciseNotFoundError();
  }
  return { ...exercise, clubId };
}

function rowOf(
  target: { readonly clubId: string; readonly exerciseId: string },
  fields: ValidFields,
  paths: StoredPhotoPaths,
): ClubExerciseRow {
  return {
    id: target.exerciseId,
    clubId: target.clubId,
    ...fields,
    imageStartPath: paths.start,
    imageEndPath: paths.end,
  };
}

export async function searchExercises(
  gateways: ClubExercisesGateways,
  request: { readonly callerId: string; readonly query: string },
): Promise<ManagedExercises> {
  const text = request.query.trim();
  if (countCharacters(text) > EXERCISE_QUERY_MAX_LENGTH) {
    throw new ExerciseValidationError("query_too_long");
  }
  const actor = await findTrainingPlanner(gateways.members, request.callerId);
  const found = await gateways.exercises.searchExercises({
    clubId: actor.clubId,
    text,
    limit: EXERCISE_SEARCH_LIMIT,
  });
  return { exercises: await describeExercises(gateways, actor.clubId, found) };
}

/** Todo se comprueba antes de subir nada; si la fila no entra, las fotos
 * subidas se borran. */
export async function createClubExercise(
  gateways: ClubExercisesGateways,
  request: {
    readonly callerId: string;
    readonly fields: ClubExerciseFields;
    readonly photos: PhotoChanges;
  },
): Promise<ManagedExercise> {
  const fields = validFields(request.fields);
  const photos = validPhotoChanges(request.photos);
  const actor = await findTrainingPlanner(gateways.members, request.callerId);
  await ensureNameFree(gateways, {
    clubId: actor.clubId,
    name: fields.name,
    exceptId: null,
  });
  const target = { clubId: actor.clubId, exerciseId: gateways.newExerciseId() };
  const stored = await storePhotos(gateways, {
    target,
    changes: photos,
    previous: { start: null, end: null },
  });
  const row = rowOf(target, fields, stored.paths);
  await insertOrCleanUp(gateways, row, stored.uploaded);
  await recordExerciseEvent(gateways, {
    actor,
    action: "training_exercise.created",
    exerciseId: row.id,
  });
  return describeExercise(gateways, row);
}

async function insertOrCleanUp(
  gateways: ClubExercisesGateways,
  row: ClubExerciseRow,
  uploaded: readonly string[],
): Promise<void> {
  let result: ExerciseWriteResult;
  try {
    result = await gateways.exercises.insertExercise(row);
  } catch (error) {
    await removePhotosQuietly(gateways, uploaded);
    throw error;
  }
  if (result.kind !== "saved") {
    await removePhotosQuietly(gateways, uploaded);
    throw new ExerciseNameTakenError();
  }
}

/** Sustituye los datos. Una foto que cambia de tipo cambia de ruta: la vieja
 * se borra después de guardar. Una del mismo tipo se sobrescribe en su ruta
 * antes de guardar la fila, así que si otro gana el nombre o borra el
 * ejercicio entretanto, la foto nueva se queda: es una carrera rara y no
 * pierde nada que el planificador no quisiera cambiar. */
export async function updateClubExercise(
  gateways: ClubExercisesGateways,
  request: {
    readonly callerId: string;
    readonly exerciseId: string;
    readonly fields: ClubExerciseFields;
    readonly photos: PhotoChanges;
  },
): Promise<ManagedExercise> {
  const fields = validFields(request.fields);
  const photos = validPhotoChanges(request.photos);
  const actor = await findTrainingPlanner(gateways.members, request.callerId);
  const target = { clubId: actor.clubId, exerciseId: request.exerciseId };
  const existing = await findOwnClubExercise(gateways, target);
  await ensureNameFree(gateways, {
    clubId: actor.clubId,
    name: fields.name,
    exceptId: existing.id,
  });
  const previous = storedPhotoPaths(existing);
  const stored = await storePhotos(gateways, {
    target,
    changes: photos,
    previous,
  });
  const row = rowOf(target, fields, stored.paths);
  const result = await gateways.exercises.updateExercise(row);
  if (result.kind !== "saved") {
    // Otro le ganó el nombre o lo borró entretanto: lo subido a una ruta
    // nueva sobra.
    await removePhotosQuietly(gateways, stalePaths(stored.paths, previous));
    throw result.kind === "name_taken"
      ? new ExerciseNameTakenError()
      : new ExerciseNotFoundError();
  }
  await removePhotosQuietly(gateways, stalePaths(previous, stored.paths));
  await recordExerciseEvent(gateways, {
    actor,
    action: "training_exercise.updated",
    exerciseId: row.id,
  });
  return describeExercise(gateways, row);
}

function stalePaths(
  previous: StoredPhotoPaths,
  current: StoredPhotoPaths,
): readonly string[] {
  const kept = new Set(Object.values(current));
  return Object.values(previous).filter(
    (path): path is string => path !== null && !kept.has(path),
  );
}

/** No se borra uno que usa alguna rutina: lo decide la clave de la fila. */
export async function deleteClubExercise(
  gateways: ClubExercisesGateways,
  request: { readonly callerId: string; readonly exerciseId: string },
): Promise<void> {
  const actor = await findTrainingPlanner(gateways.members, request.callerId);
  const exercise = await findOwnClubExercise(gateways, {
    clubId: actor.clubId,
    exerciseId: request.exerciseId,
  });
  const result = await gateways.exercises.deleteExercise({
    clubId: actor.clubId,
    exerciseId: exercise.id,
  });
  if (result.kind === "in_use") {
    throw new ExerciseInUseError();
  }
  await removePhotosQuietly(
    gateways,
    stalePaths(storedPhotoPaths(exercise), { start: null, end: null }),
  );
  await recordExerciseEvent(gateways, {
    actor,
    action: "training_exercise.deleted",
    exerciseId: exercise.id,
  });
}
