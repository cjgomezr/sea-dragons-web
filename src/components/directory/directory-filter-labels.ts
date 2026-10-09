import type { AufFilter, MembershipFilter } from "@/lib/directory/directory";
import type { MessageKey } from "@/lib/i18n/message";

/**
 * Cómo se llama cada valor de los filtros de AUF y de membresía (#497). Los
 * leen los desplegables y, desde #548, las fichas de los filtros activos:
 * los dos tienen que decir lo mismo.
 */

export const AUF_FILTER_KEYS = {
  missing: "directory.filter.auf.missing",
  expired: "directory.filter.auf.expired",
  expiring: "directory.filter.auf.expiring",
  unverified: "directory.filter.auf.unverified",
} as const satisfies Record<AufFilter, MessageKey>;

export const MEMBERSHIP_FILTER_KEYS = {
  pending: "directory.filter.membership.pending",
  trialing: "directory.filter.membership.trialing",
  active: "directory.filter.membership.active",
  past_due: "directory.filter.membership.pastDue",
  cancelled: "directory.filter.membership.cancelled",
  waived: "directory.filter.membership.waived",
  none: "directory.filter.membership.none",
} as const satisfies Record<MembershipFilter, MessageKey>;
