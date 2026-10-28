import { readLimitedBody } from "@/lib/api/read-limited-body";
import { ApiError } from "@/lib/api/response";
import {
  type ClubExerciseFields,
  EXERCISE_PHOTO_MAX_BYTES,
  type ExercisePhotoSlot,
  ExerciseValidationError,
  type PhotoChange,
  type PhotoChanges,
} from "./club-exercises";

/**
 * El formulario de un ejercicio del club (#903, RF-10): `multipart/form-data`
 * con `name`, `tips` (uno por línea), `youtube` y las fotos `startPhoto` y
 * `endPhoto`. Al editar, `removeStartPhoto` y `removeEndPhoto` a `true`
 * quitan la que hubiera; una foto que no viene se queda como estaba. Un campo
 * que no es ninguno de éstos es un 400, como en los cuerpos JSON.
 */

/** Las dos fotos y holgura para los textos y las cabeceras del formulario:
 * un cuerpo mayor se corta sin leerlo entero. */
const FORM_TEXT_ALLOWANCE_BYTES = 64 * 1024;
const FORM_MAX_BYTES = 2 * EXERCISE_PHOTO_MAX_BYTES + FORM_TEXT_ALLOWANCE_BYTES;

const TEXT_FIELDS = ["name", "tips", "youtube"] as const;

const PHOTO_FIELDS: Readonly<Record<ExercisePhotoSlot, string>> = {
  start: "startPhoto",
  end: "endPhoto",
};

const REMOVE_FIELDS: Readonly<Record<ExercisePhotoSlot, string>> = {
  start: "removeStartPhoto",
  end: "removeEndPhoto",
};

const REMOVE_VALUE = "true";

export type ClubExerciseFormMode = "create" | "update";

export type ClubExerciseForm = {
  readonly fields: ClubExerciseFields;
  readonly photos: PhotoChanges;
};

function rejectForm(message: string): never {
  throw new ApiError("validation_error", message);
}

function allowedFields(mode: ClubExerciseFormMode): ReadonlySet<string> {
  const photoFields = Object.values(PHOTO_FIELDS);
  const removeFields = mode === "update" ? Object.values(REMOVE_FIELDS) : [];
  return new Set([...TEXT_FIELDS, ...photoFields, ...removeFields]);
}

async function readFormData(request: Request): Promise<FormData> {
  const body = await readLimitedBody(request, FORM_MAX_BYTES);
  if (body.kind === "too_large") {
    throw new ExerciseValidationError("photo_too_large");
  }
  const contentType = request.headers.get("content-type") ?? "";
  try {
    return await new Response(new Uint8Array(body.bytes), {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    return rejectForm("El cuerpo tiene que ser un formulario multipart.");
  }
}

function readText(
  form: FormData,
  field: (typeof TEXT_FIELDS)[number],
): string | null {
  const value = form.get(field);
  if (value === null || typeof value === "string") {
    return value;
  }
  return rejectForm(`"${field}" tiene que ser texto, no un fichero.`);
}

function readFields(form: FormData): ClubExerciseFields {
  const name = readText(form, "name");
  if (name === null) {
    return rejectForm('Falta "name".');
  }
  return {
    name,
    tips: readText(form, "tips") ?? "",
    youtube: readText(form, "youtube") ?? "",
  };
}

/** Un campo de foto que nadie rellenó llega como un fichero vacío sin
 * nombre, que el lector del formulario a veces entrega como texto vacío. */
async function readPhotoChange(
  form: FormData,
  slot: ExercisePhotoSlot,
): Promise<PhotoChange> {
  const value = form.get(PHOTO_FIELDS[slot]);
  const isRemoved = form.get(REMOVE_FIELDS[slot]) === REMOVE_VALUE;
  if (typeof value === "string" && value !== "") {
    return rejectForm(`"${PHOTO_FIELDS[slot]}" tiene que ser un fichero.`);
  }
  const file = typeof value === "string" ? null : value;
  const hasFile = file !== null && file.size > 0;
  if (hasFile && isRemoved) {
    return rejectForm(
      `"${PHOTO_FIELDS[slot]}" y "${REMOVE_FIELDS[slot]}" se excluyen.`,
    );
  }
  if (hasFile) {
    return { kind: "replace", bytes: new Uint8Array(await file.arrayBuffer()) };
  }
  return isRemoved ? { kind: "remove" } : { kind: "keep" };
}

export async function readClubExerciseForm(
  request: Request,
  mode: ClubExerciseFormMode,
): Promise<ClubExerciseForm> {
  const form = await readFormData(request);
  const allowed = allowedFields(mode);
  const unknown = [...form.keys()].find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    return rejectForm(`El campo "${unknown}" no se admite.`);
  }
  return {
    fields: readFields(form),
    photos: {
      start: await readPhotoChange(form, "start"),
      end: await readPhotoChange(form, "end"),
    },
  };
}
