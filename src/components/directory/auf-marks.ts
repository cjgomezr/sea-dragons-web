import type { Translator } from "@/lib/i18n/translator";

/**
 * Las marcas del registro federativo (BR-008) que sólo ve un Admin, las
 * mismas en la fila del directorio y en la cabecera de la ficha (#274).
 *
 * Una marca dice algo con palabras, nunca sólo con color. El tono separa lo
 * que sólo informa de lo que pide hacer algo: un AUF sin verificar pide que
 * un Admin lo revise, y uno vencido que se renueve. Verificado y vencido no
 * se excluyen: la verificación dice que el dato es cierto, el vencimiento que
 * ya no vale.
 */

export type RowMark = {
  readonly text: string;
  readonly tone: "neutral" | "warning";
};

export type AufState = {
  readonly aufNumber: string | null;
  readonly isAufVerified: boolean;
  readonly isAufExpired: boolean;
};

function verificationMarkOf(translate: Translator, auf: AufState): RowMark {
  return auf.isAufVerified
    ? { text: translate("directory.mark.aufVerified"), tone: "neutral" }
    : { text: translate("directory.mark.aufNotVerified"), tone: "warning" };
}

export function aufMarksOf(
  translate: Translator,
  auf: AufState,
): readonly RowMark[] {
  if (auf.aufNumber === null) {
    return [];
  }
  return [
    verificationMarkOf(translate, auf),
    ...(auf.isAufExpired
      ? [
          {
            text: translate("directory.mark.aufExpired"),
            tone: "warning" as const,
          },
        ]
      : []),
  ];
}
