import { useId } from "react";
import { describeRsvpFailure } from "@/components/calendar/agenda-client";
import { DateBlock } from "@/components/calendar/AgendaRow";
import { EventRsvp } from "@/components/calendar/EventRsvp";
import { useEventRsvp } from "@/components/calendar/use-event-rsvp";
import type { NextTraining } from "@/lib/dashboard/dashboard";
import { formatClockTime } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";

/**
 * La tarjeta del próximo entrenamiento del mockup del móvil (#426, RF-3 del
 * PRD de E14), con los botones Sí, Quizás y No del calendario. Guarda por el
 * mismo camino que una fila de la agenda: la misma petición, el mismo corte
 * del doble toque y el mismo aviso si falla.
 *
 * Sólo se ve por debajo de 768 px; en escritorio el RSVP se responde en el
 * calendario, como en el mockup. Lo decide la hoja de estilos.
 */

// El detalle que llega tras guardar sirve a la fila desplegada del
// calendario; aquí no hay nada desplegado que poner al día.
function ignoreOpenedDetail(): void {}

export function NextTrainingCard({
  translate,
  training,
}: {
  readonly translate: Translator;
  readonly training: NextTraining;
}): React.JSX.Element {
  const titleId = useId();
  const { state, respond } = useEventRsvp(training, ignoreOpenedDetail);
  return (
    <section className="dashboard-training-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="dashboard-training-card-title">
        {translate("dashboard.tile.nextTraining")}
      </h2>
      <div className="dashboard-training-card-event">
        <DateBlock translate={translate} startsOn={training.startsOn} />
        <div>
          <p className="dashboard-event-title">{training.title}</p>
          <p className="dashboard-event-when">
            {translate("calendar.event.timeAndPlace", {
              time: formatClockTime(translate.locale, training.startTime),
              location: training.location,
            })}
          </p>
        </div>
      </div>
      <EventRsvp
        translate={translate}
        title={training.title}
        savedResponse={state.tally.myResponse}
        pendingResponse={state.pendingResponse}
        onRespond={respond}
      />
      <p className="agenda-rsvp-status" role="status">
        {state.pendingResponse === null
          ? null
          : translate("calendar.rsvp.saving")}
      </p>
      {state.failure === null ? null : (
        <p className="auth-error agenda-rsvp-error" role="alert">
          {describeRsvpFailure(translate, state.failure)}
        </p>
      )}
    </section>
  );
}
