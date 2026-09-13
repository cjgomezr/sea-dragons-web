import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import {
  type ConfirmationEmailOutcome,
  type RegistrationReceipt,
  RegistrationValidationError,
  registerMember,
} from "@/lib/auth/register-member";
import type { RegistrationIssue } from "@/lib/auth/registration";
import {
  DEFAULT_CLUB_SLUG,
  createSupabaseAuthGateways,
  describeMissingAuthKeys,
} from "@/lib/auth/supabase-auth-gateways";

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
 * bien: el servicio incorporado de Supabase manda 2 mensajes por hora y se
 * niega a escribir fuera del equipo del proyecto. El fallo se registra con su
 * motivo y la respuesta no cambia (#147): la pantalla ofrece reenviarlo en
 * cualquier caso. Nunca se registra la dirección: es un dato personal, y el
 * adaptador ya la quita del motivo. */
function reportConfirmationEmail(outcome: ConfirmationEmailOutcome): void {
  if (outcome.kind === "failed" || outcome.kind === "rate_limited") {
    console.error(
      "[api/v1/auth/register] no se pudo pedir el correo de confirmación",
      outcome.reason,
    );
  }
}

const postRegistration = createApiRoute<RegistrationResponse, RegistrationBody>(
  {
    schema: registrationBodySchema,
    handler: async ({ body }) => {
      const wiring = createSupabaseAuthGateways(process.env);
      if (wiring.kind === "unconfigured") {
        throw new ApiError(
          "service_unavailable",
          describeMissingAuthKeys(wiring.missingKeys),
        );
      }

      const clubId =
        await wiring.gateways.clubs.findClubIdBySlug(DEFAULT_CLUB_SLUG);

      try {
        const result = await registerMember(wiring.gateways.registration, {
          request: body,
          clubId,
          now: new Date(),
        });
        reportConfirmationEmail(result.confirmationEmail);
        return { data: result.receipt };
      } catch (error) {
        if (error instanceof RegistrationValidationError) {
          throw new ApiError("business_rule", describeIssues(error.issues));
        }
        throw error;
      }
    },
  },
);

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: postRegistration,
});
