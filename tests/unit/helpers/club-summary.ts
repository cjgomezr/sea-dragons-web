import type { ClubSummary } from "@/lib/directory/directory";

/** El resumen del club (#551) de una lista del Admin en la que nadie pide
 * atención: lo que llevan las respuestas de prueba que no lo miran. */
export const QUIET_CLUB_SUMMARY: ClubSummary = {
  aufRenewals: [],
  attention: {
    aufMissing: 0,
    aufRenewal: 0,
    withoutEmergencyContact: 0,
    membershipPastDue: 0,
  },
};
