import { z } from "zod";
import { runAfterResponse } from "@/lib/api/after-response";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  type ConfirmationEmailOutcome,
  type PendingRegistration,
  type RegistrationGateways,
  type RegistrationInput,
  type RegistrationReceipt,
  RegistrationValidationError,
  prepareRegistration,
} from "@/lib/auth/register-member";
import type { RegistrationIssue } from "@/lib/auth/registration";
import {
  DEFAULT_CLUB_SLUG,
  createSupabaseAuthGateways,
  describeMissingAuthKeys,
} from "@/lib/auth/supabase-auth-gateways";
import { describeErrorWithoutEmail } from "@/lib/email/redact-email";

// Crea cuentas: la respuesta depende del estado de la base en este instante y
// no puede servirse desde una caché.
export const dynamic = "force-dynamic";

/** Sólo la forma del cuerpo. Que el país exista, que la contraseña llegue al
 * mínimo y que el tipo de membresía esté en el conjunto cerrado son reglas del
 * dominio, y se responden con 422 nombrando el campo, no con 400. */
const registrationBodySchema = z.object({
  fullName: z.string(),
  email: z.string(),
  country: z.string(),
  password: z.string(),
  membershipType: z.string(),
  dateOfBirth: z.string(),
});

type RegistrationBody = z.infer<typeof registrationBodySchema>;

export type RegistrationResponse = RegistrationReceipt;

function describeIssues(issues: readonly RegistrationIssue[]): string {
  return issues.map((issue) => `${issue.field}: ${issue.message}`).join(" ");
}

/** El correo de confirmación se pide, pero no decide si el registro salió
 * bien: sin la clave de Resend (un preview, una máquina de desarrollo) o con
 * el proveedor fallando, la cuenta queda creada igual. El fallo se registra
 * con su motivo y la respuesta no cambia (#147): la pantalla ofrece reenviarlo
 * en cualquier caso. Nunca se registra la dirección: es un dato personal, y el
 * adaptador ya la quita del motivo. */
function reportConfirmationEmail(outcome: ConfirmationEmailOutcome): void {
  if (outcome.kind !== "requested" && outcome.kind !== "not_requested") {
    console.error(
      "[api/v1/auth/register] no se pudo pedir el correo de confirmación",
      outcome.reason,
    );
  }
}

/** Corre la creación de la cuenta cuando la respuesta ya salió. Un fallo de
 * Supabase o de Resend no puede cambiar esa respuesta sin delatar la cuenta,
 * así que va al registro del servidor con su cadena de causas y sin la
 * dirección. */
async function registerAfterResponse(
  deliver: () => Promise<ConfirmationEmailOutcome>,
  email: string,
): Promise<void> {
  try {
    reportConfirmationEmail(await deliver());
  } catch (error) {
    console.error(
      "[api/v1/auth/register] no se pudo completar el registro",
      describeErrorWithoutEmail(error, email),
    );
  }
}

function prepareOrReject(
  gateways: RegistrationGateways,
  input: RegistrationInput,
): PendingRegistration {
  try {
    return prepareRegistration(gateways, input);
  } catch (error) {
    if (error instanceof RegistrationValidationError) {
      throw new ApiError("business_rule", describeIssues(error.issues));
    }
    throw error;
  }
}

const postRegistration = createApiRoute<RegistrationResponse, RegistrationBody>(
  {
    schema: registrationBodySchema,
    handler: async ({ request, body }) => {
      const wiring = createSupabaseAuthGateways(process.env);
      if (wiring.kind === "unconfigured") {
        throw new ApiError(
          "service_unavailable",
          describeMissingAuthKeys(wiring.missingKeys),
        );
      }

      const clubId =
        await wiring.gateways.clubs.findClubIdBySlug(DEFAULT_CLUB_SLUG);

      const { receipt, deliver } = prepareOrReject(
        wiring.gateways.registration,
        { request: body, clubId, now: new Date(), appUrl: request.url },
      );
      // Crear la cuenta va después de responder: sólo ahí se sabe si la
      // dirección ya tenía una, y lo que tardara la respuesta la delataría.
      runAfterResponse(() => registerAfterResponse(deliver, receipt.email));
      return { data: receipt };
    },
  },
);

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postRegistration,
});
