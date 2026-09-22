import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import {
  asClubAdministrationApiError,
  requireClubAdministrationGateways,
} from "@/lib/auth/club-administration-api";
import {
  type ClubMember,
  listClubMembers,
} from "@/lib/auth/club-administration";
import { readApiRequestLocale } from "@/lib/i18n/request-locale";
import { AUF_NUMBER_MAX_LENGTH } from "@/lib/members/member-record";
import {
  type CreatedMember,
  createInvitedMember,
} from "@/lib/members/member-invitation";
import {
  asMemberInvitationApiError,
  requireMemberInvitationGateways,
} from "@/lib/members/member-invitation-api";
import { clubCalendarDate } from "@/lib/time/club-calendar";

/**
 * Los socios del club (FR-015 reducido a lo que RF-8 pide, #212), y el alta
 * de uno nuevo por un Admin con su invitación por correo (#243, FR-020,
 * FR-021).
 *
 * Quién puede llamarlo lo decide la frontera: `RESTRICTED_ROUTES` reserva todo
 * `/api/v1/members` a la capacidad de gestionar usuarios y roles. De qué club
 * son los socios no se pregunta: sale de la fila de quien llama, identificado
 * por su cookie de sesión.
 *
 * Devuelve nombre, correo, rol y el `user_id` con el que se les cambia el rol.
 * Nada más: la fecha de nacimiento, el tutor y el país son del perfil de E5.
 *
 * El POST crea al miembro como Player con la cuenta pendiente de activar, le
 * asigna sus grupos y le manda la invitación en el idioma del Admin. La
 * invitación sale antes de responder: si no sale, el miembro queda creado y
 * la respuesta lo dice para que la pantalla ofrezca reenviarla.
 */

// Depende de la sesión de quien llama y de los socios que haya ahora.
export const dynamic = "force-dynamic";

/** Los socios del club de quien llama, ordenados por nombre. */
export type ClubMembersResponse = { readonly members: readonly ClubMember[] };

const getClubMembers = createApiRoute<ClubMembersResponse>({
  handler: async ({ request, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    try {
      return {
        data: {
          members: await listClubMembers(
            requireClubAdministrationGateways(),
            callerId,
          ),
        },
      };
    } catch (error) {
      asClubAdministrationApiError(error);
    }
  },
});

/** Topes holgados sólo para no arrastrar un cuerpo de megas hasta el dominio,
 * que es quien decide qué vale y dice por qué. El del correo es el de una
 * dirección (RFC 3696); el de los grupos, muy por encima de los que tiene un
 * club. */
const FULL_NAME_BODY_MAX_LENGTH = 200;
const EMAIL_BODY_MAX_LENGTH = 320;
const CATALOG_BODY_MAX_LENGTH = 40;
const AUF_NUMBER_BODY_MAX_LENGTH = AUF_NUMBER_MAX_LENGTH * 4;
const DATE_BODY_MAX_LENGTH = 10;
const GROUP_IDS_MAX = 100;

/** Sólo la forma: todos los campos son obligatorios y `strict` responde 400 a
 * cualquier otro, como el rol, que nace Player. */
const newMemberBodySchema = z
  .object({
    fullName: z.string().max(FULL_NAME_BODY_MAX_LENGTH),
    email: z.string().max(EMAIL_BODY_MAX_LENGTH),
    country: z.string().max(CATALOG_BODY_MAX_LENGTH),
    position: z.string().max(CATALOG_BODY_MAX_LENGTH),
    experienceLevel: z.string().max(CATALOG_BODY_MAX_LENGTH),
    gender: z.string().max(CATALOG_BODY_MAX_LENGTH),
    aufNumber: z.string().max(AUF_NUMBER_BODY_MAX_LENGTH),
    aufExpiry: z.string().max(DATE_BODY_MAX_LENGTH),
    groupIds: z.array(z.uuid()).max(GROUP_IDS_MAX),
  })
  .strict();

type NewMemberBody = z.infer<typeof newMemberBodySchema>;

/** El miembro creado y si su invitación salió. El motivo de un envío fallido
 * se queda en el registro del servidor. */
export type NewMemberResponse = {
  readonly member: CreatedMember["member"];
  readonly invitation: CreatedMember["invitation"]["kind"];
};

function toNewMemberResponse(created: CreatedMember): NewMemberResponse {
  if (created.invitation.kind === "not_sent") {
    console.error(
      "[api/v1/members] el miembro quedó creado pero la invitación no salió",
      created.invitation.reason,
    );
  }
  return { member: created.member, invitation: created.invitation.kind };
}

const postNewMember = createApiRoute<NewMemberResponse, NewMemberBody>({
  schema: newMemberBodySchema,
  emailField: "email",
  handler: async ({ request, body, decorateResponse }) => {
    const callerId = await identifyAccountCaller({ request, decorateResponse });
    const now = new Date();
    try {
      const created = await createInvitedMember(
        requireMemberInvitationGateways(),
        {
          callerId,
          submission: body,
          // El día de ingreso, contra el que se mide el AUF (NFR-003).
          todayInClub: clubCalendarDate(now),
          now,
          locale: readApiRequestLocale(request),
          appUrl: request.url,
        },
      );
      return { data: toNewMemberResponse(created), status: 201 };
    } catch (error) {
      asMemberInvitationApiError(error);
    }
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getClubMembers,
  POST: postNewMember,
});
