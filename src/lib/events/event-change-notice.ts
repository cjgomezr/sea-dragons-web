import type { EventFields } from "./event-creation";
import {
  type EventNoticeGateways,
  notifyEventAudience,
} from "./event-creation-notice";
import type { ManagedEvent } from "./event-management";
import type { ManagedSeries } from "./series-management";

/**
 * El aviso a la audiencia cuando un evento, una ocurrencia o una serie
 * cambian de fecha, hora o lugar, o se cancelan (#317, RF-13 del PRD de E7).
 * Quien pensaba ir tiene que enterarse; un título o unas notas nuevas no le
 * cambian el plan, así que no se avisan.
 *
 * Tras un cambio de audiencia se avisa a la nueva: quien salió de ella queda
 * fuera de alcance. Una serie se avisa una sola vez, no una por ocurrencia.
 * Todo va por `notifyEventAudience`, que no lanza: el cambio ya está guardado
 * cuando se llega aquí.
 */

/** Lo que decide si quien pensaba ir tiene que enterarse. */
type SessionSchedule = Pick<EventFields, "startTime" | "location"> & {
  readonly startsOn: string;
};

export function isNoticeworthyChange(
  before: SessionSchedule,
  after: SessionSchedule,
): boolean {
  return (
    before.startsOn !== after.startsOn ||
    before.startTime !== after.startTime ||
    before.location !== after.location
  );
}

type Change<Subject> = {
  readonly clubId: string;
  readonly authorId: string;
  readonly before: Subject;
  readonly after: Subject;
};

type Cancellation<Subject> = {
  readonly clubId: string;
  readonly authorId: string;
  readonly cancelled: Subject;
};

export async function announceEventChange(
  gateways: EventNoticeGateways,
  change: Change<ManagedEvent>,
): Promise<void> {
  const { before, after } = change;
  if (!isNoticeworthyChange(before, after)) {
    return;
  }
  await notifyEventAudience(gateways, {
    ...change,
    audience: after.audience,
    content: {
      type: "event_changed",
      data: {
        eventId: after.id,
        title: after.title,
        startsOn: after.startsOn,
        startTime: after.startTime,
        location: after.location,
      },
    },
  });
}

export async function announceEventCancellation(
  gateways: EventNoticeGateways,
  cancellation: Cancellation<ManagedEvent>,
): Promise<void> {
  const { cancelled } = cancellation;
  await notifyEventAudience(gateways, {
    ...cancellation,
    audience: cancelled.audience,
    content: {
      type: "event_cancelled",
      data: {
        eventId: cancelled.id,
        title: cancelled.title,
        startsOn: cancelled.startsOn,
        startTime: cancelled.startTime,
      },
    },
  });
}

export async function announceSeriesChange(
  gateways: EventNoticeGateways,
  change: Change<ManagedSeries>,
): Promise<void> {
  const { before, after } = change;
  if (!isNoticeworthyChange(before, after)) {
    return;
  }
  await notifyEventAudience(gateways, {
    ...change,
    audience: after.audience,
    content: {
      type: "event_series_changed",
      data: {
        seriesId: after.id,
        title: after.title,
        weekdays: after.weekdays,
        startTime: after.startTime,
        location: after.location,
      },
    },
  });
}

export async function announceSeriesCancellation(
  gateways: EventNoticeGateways,
  cancellation: Cancellation<ManagedSeries>,
): Promise<void> {
  const { cancelled } = cancellation;
  await notifyEventAudience(gateways, {
    ...cancellation,
    audience: cancelled.audience,
    content: {
      type: "event_series_cancelled",
      data: {
        seriesId: cancelled.id,
        title: cancelled.title,
        weekdays: cancelled.weekdays,
        startTime: cancelled.startTime,
      },
    },
  });
}
