import { z } from "zod";
import {
  type ApiRequestFailure,
  type ApiRequestOutcome,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { CLUB_SESSION_PACKS_API_PATH } from "@/lib/auth/routes";
import {
  MAX_PACK_SESSIONS,
  MIN_PACK_SESSIONS,
  SESSION_PACK_ISSUE_CODES,
  type SessionPackIssueCode,
} from "@/lib/club/session-packs";
import type { Translator } from "@/lib/i18n/translator";
import type { ClubPrice } from "@/lib/membership/stripe-prices";

/**
 * Lo que la sección de los packs de sesiones (#469) le pide a la API v1 y
 * cómo reduce cada respuesta a algo que pintar. Nada habla con la base: la
 * aplicación nativa de Release 2 usará este mismo camino (CON-002).
 */

const clubPriceSchema: z.ZodType<ClubPrice> = z.union([
  z.object({ amountCents: z.number().int(), currency: z.literal("AUD") }),
  z.object({
    amountCents: z.null(),
    reason: z.enum(["not_configured", "stripe_unavailable", "misconfigured"]),
  }),
]);

const responseSchema = z.object({
  data: z.object({
    packs: z.array(z.object({ sessions: z.number().int() })),
    sessionPrice: clubPriceSchema,
  }),
});

/** Lo que la pantalla necesita: los tamaños en orden y el precio de una
 * sesión, con el que calcula también el de un pack aún sin guardar. */
export type SessionPacksDraft = {
  readonly sizes: readonly number[];
  readonly sessionPrice: ClubPrice;
};

export type SessionPacksRead =
  | { readonly kind: "loaded"; readonly packs: SessionPacksDraft }
  | ApiRequestFailure;

async function readPacksResponse(
  request: Promise<ApiRequestOutcome>,
): Promise<SessionPacksRead> {
  const read = readApiPayload(await request, responseSchema);
  if (read.kind === "failed") {
    return read;
  }
  const { packs, sessionPrice } = read.value.data;
  return {
    kind: "loaded",
    packs: { sizes: packs.map((pack) => pack.sessions), sessionPrice },
  };
}

export function loadSessionPacks(): Promise<SessionPacksRead> {
  return readPacksResponse(requestApi(CLUB_SESSION_PACKS_API_PATH));
}

export function saveSessionPacks(
  sizes: readonly number[],
): Promise<SessionPacksRead> {
  return readPacksResponse(
    requestApi(CLUB_SESSION_PACKS_API_PATH, {
      method: "PUT",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify({ sessions: sizes }),
    }),
  );
}

function readIssueCode(reason: string | null): SessionPackIssueCode | null {
  return SESSION_PACK_ISSUE_CODES.find((code) => code === reason) ?? null;
}

export function describeSessionPackIssue(
  translate: Translator,
  code: SessionPackIssueCode,
): string {
  switch (code) {
    case "packs_required":
      return translate("clubSettings.sessionPacks.issue.required");
    case "pack_sessions_out_of_range":
      return translate("clubSettings.sessionPacks.issue.outOfRange", {
        min: MIN_PACK_SESSIONS,
        max: MAX_PACK_SESSIONS,
      });
    case "pack_sessions_repeated":
      return translate("clubSettings.sessionPacks.issue.repeated");
  }
}

export function describeSessionPacksFailure(
  translate: Translator,
  failure: ApiRequestFailure,
): string {
  const issue = readIssueCode(failure.reason);
  if (failure.failure === "validation_error" && issue !== null) {
    return describeSessionPackIssue(translate, issue);
  }
  switch (failure.failure) {
    case "network":
      return translate("auth.error.network");
    case "unauthenticated":
      return translate("clubSettings.error.signInRequired");
    case "forbidden":
      return translate("clubSettings.sessionPacks.error.forbidden");
    default:
      return translate("clubSettings.error.unexpected");
  }
}
