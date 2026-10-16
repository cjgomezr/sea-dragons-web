import { CalendarPlus } from "@phosphor-icons/react/dist/ssr/CalendarPlus";
import { saveFile } from "@/components/save-file";
import type { AgendaEvent } from "@/lib/events/event-agenda";
import { buildEventIcs } from "@/lib/events/event-ics";
import { placeTextOf } from "@/lib/events/event-place";
import type { Translator } from "@/lib/i18n/translator";

const CALENDAR_MIME_TYPE = "text/calendar;charset=utf-8";

/**
 * "Agregar a mi calendario" (#649, RF-8 y D9 del PRD de E24): baja el `.ics`
 * de esta sesión, generado en el navegador. Va en el bloque de hora del
 * panel; en el móvil lo coloca #656.
 */
export function AddToCalendarButton({
  translate,
  event,
  notes,
}: {
  readonly translate: Translator;
  readonly event: AgendaEvent;
  /** Llegan con el detalle: hasta entonces el archivo va sin ellas. */
  readonly notes: string | null;
}): React.JSX.Element {
  function downloadIcs(): void {
    const ics = buildEventIcs(
      { ...event, location: placeTextOf(event), notes },
      new Date(),
    );
    saveFile(
      new Blob([ics], { type: CALENDAR_MIME_TYPE }),
      `${event.title}.ics`,
    );
  }

  return (
    <button
      type="button"
      className="agenda-icon-button"
      aria-label={translate("calendar.panel.addToCalendar")}
      onClick={downloadIcs}
    >
      <CalendarPlus aria-hidden="true" focusable="false" size={20} />
    </button>
  );
}
