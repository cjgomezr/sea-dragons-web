import { Lock } from "@phosphor-icons/react/dist/ssr/Lock";
import type { Translator } from "@/lib/i18n/translator";

/**
 * La lectura de Sobre mí (#772): una lista de etiqueta y valor en dos
 * columnas. Un dato vacío se pinta con un guion, que un lector de pantalla
 * oye como "sin indicar". Lo que sólo ve el socio lleva el candado.
 */

/** El guion del diseño para un dato que no está. */
const EMPTY_VALUE = "—";

export type DetailRow = {
  readonly label: string;
  readonly value: string | null;
  /** Lo ve sólo el socio (D4): el género. */
  readonly isOnlyYou: boolean;
};

export function EmptyValue({
  translate,
}: {
  translate: Translator;
}): React.JSX.Element {
  return (
    <>
      <span aria-hidden="true">{EMPTY_VALUE}</span>
      <span className="visually-hidden">{translate("profileCard.empty")}</span>
    </>
  );
}

export function DetailList({
  translate,
  rows,
}: {
  translate: Translator;
  rows: readonly DetailRow[];
}): React.JSX.Element {
  return (
    <dl className="profile-details">
      {rows.map((row) => (
        <div key={row.label} className="profile-detail">
          <dt>
            {row.label}
            {row.isOnlyYou ? (
              <>
                <Lock aria-hidden="true" weight="regular" />
                <span className="visually-hidden">
                  {" "}
                  {translate("profileCard.onlyYou")}
                </span>
              </>
            ) : null}
          </dt>
          <dd>
            {row.value === null ? (
              <EmptyValue translate={translate} />
            ) : (
              row.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
