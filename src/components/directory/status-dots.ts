import type { AdminDirectoryMember } from "@/lib/directory/directory";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Los puntos de estado de una fila del directorio (#549, RF-3 del PRD de
 * E21), que sólo ve un Admin. Sustituyen en la fila a las etiquetas del AUF y
 * de la membresía, que siguen enteras en la ficha.
 *
 * Dos tonos: peligro para lo que ya pide hacer algo (el AUF vencido, la
 * membresía atrasada) y aviso para lo que hay que revisar pronto (sin número
 * de AUF, o con uno que vence en 30 días). Como manda `auf-marks.ts`, ningún
 * punto dice nada sólo con color: cada uno lleva su texto.
 */

export type StatusDotTone = "danger" | "warning";

export type StatusDot = {
  readonly text: string;
  readonly tone: StatusDotTone;
};

type DotState = Pick<
  AdminDirectoryMember,
  "aufNumber" | "isAufExpired" | "isAufExpiring" | "membershipStatus"
>;

type DotRule = {
  readonly applies: (state: DotState) => boolean;
  readonly key:
    | "directory.dot.aufExpired"
    | "directory.dot.membershipPastDue"
    | "directory.dot.aufMissing"
    | "directory.dot.aufExpiring";
  readonly tone: StatusDotTone;
};

/** En el orden en que se pintan: primero lo que pide hacer algo. */
const DOT_RULES: readonly DotRule[] = [
  {
    applies: (state) => state.isAufExpired,
    key: "directory.dot.aufExpired",
    tone: "danger",
  },
  {
    applies: (state) => state.membershipStatus === "past_due",
    key: "directory.dot.membershipPastDue",
    tone: "danger",
  },
  {
    applies: (state) => state.aufNumber === null,
    key: "directory.dot.aufMissing",
    tone: "warning",
  },
  {
    applies: (state) => state.isAufExpiring,
    key: "directory.dot.aufExpiring",
    tone: "warning",
  },
];

export function statusDotsOf(
  translate: Translator,
  state: DotState,
): readonly StatusDot[] {
  return DOT_RULES.filter((rule) => rule.applies(state)).map((rule) => ({
    text: translate(rule.key),
    tone: rule.tone,
  }));
}
