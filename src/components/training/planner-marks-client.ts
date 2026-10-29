import { z } from "zod";
import {
  TRAINING_MANAGE_MARKS_API_PATH,
  trainingManageMarkApiPath,
} from "@/lib/auth/routes";
import type { ManagedMark } from "@/lib/training/club-marks";
import {
  type PlannerOutcome,
  jsonInit,
  requestAndRead,
} from "./planner-client";

/**
 * Lo que Planificar → Marcas (#911) le pide a la API v1 de las marcas del
 * club (#903). Cada acción responde la lista entera tal como quedó. Nada
 * habla con la base: la aplicación nativa usará estos mismos caminos
 * (CON-002).
 */

export type MarkList = readonly ManagedMark[];

const managedMarkSchema: z.ZodType<ManagedMark> = z.object({
  id: z.string(),
  name: z.string(),
  unit: z.literal("kg"),
  routineRows: z.number().int().nonnegative(),
  membersRecorded: z.number().int().nonnegative(),
});

const marksResponseSchema = z.object({
  data: z.object({ marks: z.array(managedMarkSchema) }),
});

const READ_MARKS = {
  schema: marksResponseSchema,
  pick: (response: z.infer<typeof marksResponseSchema>): MarkList =>
    response.data.marks,
};

export function loadMarks(): Promise<PlannerOutcome<MarkList>> {
  return requestAndRead(TRAINING_MANAGE_MARKS_API_PATH, undefined, READ_MARKS);
}

export function createMark(name: string): Promise<PlannerOutcome<MarkList>> {
  return requestAndRead(
    TRAINING_MANAGE_MARKS_API_PATH,
    jsonInit("POST", { name }),
    READ_MARKS,
  );
}

export function renameMark(
  markId: string,
  name: string,
): Promise<PlannerOutcome<MarkList>> {
  return requestAndRead(
    trainingManageMarkApiPath(markId),
    jsonInit("PATCH", { name }),
    READ_MARKS,
  );
}

/** Con `confirm` se lleva los valores de los socios que la registraron;
 * sin él, la API se niega si los hay. */
export function deleteMark(
  markId: string,
  confirm: boolean,
): Promise<PlannerOutcome<MarkList>> {
  const path = trainingManageMarkApiPath(markId);
  return requestAndRead(
    confirm ? `${path}?confirm=true` : path,
    jsonInit("DELETE"),
    READ_MARKS,
  );
}
