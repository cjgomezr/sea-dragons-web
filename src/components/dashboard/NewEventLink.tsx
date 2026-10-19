import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import Link from "next/link";
import {
  CALENDAR_NEW_EVENT_QUERY_PARAM,
  CALENDAR_PATH,
} from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";

/** El calendario con el formulario de evento nuevo ya abierto. */
const NEW_TRAINING_HREF = `${CALENDAR_PATH}?${new URLSearchParams({
  [CALENDAR_NEW_EVENT_QUERY_PARAM]: "training",
}).toString()}`;

/**
 * "+ Evento" (#747, D12 del PRD de E27), en la cabecera del inicio y en la
 * tarjeta "Próximo" vacía. Sale sólo a quien puede crear eventos; crear lo
 * vuelve a comprobar el endpoint (#307). En el móvil se queda en el "+": el
 * nombre lo sigue diciendo entero.
 */
export function NewEventLink({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <Link
      href={NEW_TRAINING_HREF}
      className="auth-submit dashboard-new-event"
      aria-label={translate("dashboard.newEvent.label")}
    >
      <Plus aria-hidden="true" focusable="false" size={16} />
      <span className="dashboard-new-event-text">
        {translate("dashboard.newEvent")}
      </span>
    </Link>
  );
}
