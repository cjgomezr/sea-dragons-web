import Link from "next/link";
import { useId, useState } from "react";
import { CALENDAR_PATH, calendarEventHref } from "@/lib/auth/routes";
import type { Week, WeekEvent } from "@/lib/dashboard/dashboard";
import {
  type WeekDay,
  pickDefaultWeekDay,
  spreadWeekByDay,
} from "@/lib/dashboard/dashboard-week";
import type { RsvpResponse } from "@/lib/events/event-rsvp";
import {
  formatCalendarDayParts,
  formatClockTime,
  formatNarrowWeekday,
  formatPanelDay,
} from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";

/**
 * "Esta semana" del inicio (#748, RF-4 y D14 del PRD de E27): la franja de
 * hoy a hoy + 6 con un punto por tipo presente, y debajo los eventos del día
 * marcado con mi respuesta. Sin elegir, el día marcado es el del Próximo si
 * cae en la franja; si no, hoy. Cada fila abre su evento en el calendario:
 * aquí no se responde.
 */

const ANSWER_LABELS = {
  yes: "calendar.answer.yes",
  maybe: "calendar.answer.maybe",
  no: "calendar.answer.no",
} as const satisfies Record<RsvpResponse, string>;

/** El día al que lleva cada tecla desde `index`, o null si no es suya. */
function targetDayIndex(
  key: string,
  index: number,
  lastIndex: number,
): number | null {
  switch (key) {
    case "ArrowLeft":
      return Math.max(0, index - 1);
    case "ArrowRight":
      return Math.min(lastIndex, index + 1);
    case "Home":
      return 0;
    case "End":
      return lastIndex;
    default:
      return null;
  }
}

/** Las flechas, Inicio y Fin mueven el foco entre los días sin elegirlos. */
function moveDayFocus(event: React.KeyboardEvent<HTMLDivElement>): void {
  const buttons = [...event.currentTarget.querySelectorAll("button")];
  const index = buttons.findIndex((button) => button === event.target);
  const target =
    index === -1 ? null : targetDayIndex(event.key, index, buttons.length - 1);
  if (target === null) {
    return;
  }
  event.preventDefault();
  buttons[target]?.focus();
}

function describeDay(translate: Translator, day: WeekDay): string {
  const name = formatPanelDay(translate.locale, day.date);
  return day.events.length === 0
    ? translate("dashboard.week.dayEmpty", { day: name })
    : translate("dashboard.week.day", { day: name, count: day.events.length });
}

function DayButton({
  translate,
  day,
  isToday,
  isSelected,
  onSelect,
}: {
  readonly translate: Translator;
  readonly day: WeekDay;
  readonly isToday: boolean;
  readonly isSelected: boolean;
  readonly onSelect: (date: string) => void;
}): React.JSX.Element {
  const { weekday, day: dayOfMonth } = formatCalendarDayParts(
    translate.locale,
    day.date,
  );
  return (
    <button
      type="button"
      className="dashboard-week-day"
      aria-pressed={isSelected}
      aria-label={describeDay(translate, day)}
      onClick={() => onSelect(day.date)}
    >
      <span
        className={`dashboard-week-weekday${isToday ? " is-today" : ""}`}
        aria-hidden="true"
      >
        <span className="dashboard-week-weekday-short">{weekday}</span>
        <span className="dashboard-week-weekday-narrow">
          {formatNarrowWeekday(translate.locale, day.date)}
        </span>
      </span>
      <span className="dashboard-week-date" aria-hidden="true">
        {Number(dayOfMonth)}
      </span>
      <span className="dashboard-week-dots" aria-hidden="true">
        {day.eventTypes.map((eventType) => (
          <span
            key={eventType}
            className={`dashboard-week-dot dashboard-week-dot-${eventType}`}
          />
        ))}
      </span>
    </button>
  );
}

function DayStrip({
  translate,
  days,
  selectedDate,
  onSelect,
}: {
  readonly translate: Translator;
  readonly days: readonly WeekDay[];
  readonly selectedDate: string;
  readonly onSelect: (date: string) => void;
}): React.JSX.Element {
  return (
    <div
      className="dashboard-week-strip"
      role="group"
      aria-label={translate("dashboard.week.days")}
      onKeyDown={moveDayFocus}
    >
      {days.map((day, index) => (
        <DayButton
          key={day.date}
          translate={translate}
          day={day}
          isToday={index === 0}
          isSelected={day.date === selectedDate}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

/** Voy, Quizás o No puedo si respondí; "Responder" si todavía puedo. */
function MyResponse({
  translate,
  response,
  isRestricted,
}: {
  readonly translate: Translator;
  readonly response: RsvpResponse | null;
  readonly isRestricted: boolean;
}): React.JSX.Element | null {
  if (response !== null) {
    return (
      <span
        className={`dashboard-week-response dashboard-week-response-${response}`}
      >
        {translate(ANSWER_LABELS[response])}
      </span>
    );
  }
  return isRestricted ? null : (
    <span className="dashboard-week-response dashboard-week-response-rsvp">
      {translate("dashboard.week.rsvp")}
    </span>
  );
}

function EventRow({
  translate,
  event,
  today,
  isRestricted,
}: {
  readonly translate: Translator;
  readonly event: WeekEvent;
  readonly today: string;
  readonly isRestricted: boolean;
}): React.JSX.Element {
  const start = formatClockTime(translate.locale, event.startTime);
  const end =
    event.endTime === null
      ? null
      : formatClockTime(translate.locale, event.endTime);
  return (
    <li>
      <Link
        href={calendarEventHref(event, today)}
        className={`dashboard-week-event dashboard-week-event-${event.eventType}`}
      >
        <span className="dashboard-week-bar" aria-hidden="true" />
        <span className="dashboard-week-time">
          <span className="dashboard-week-start">{start}</span>
          {end === null ? null : (
            <span className="dashboard-week-end">{end}</span>
          )}
        </span>
        <span className="dashboard-week-body">
          <span className="dashboard-week-title">{event.title}</span>
          <span className="dashboard-week-place">{event.location}</span>
          {/* El móvil no tiene la columna del fin: va delante del lugar. */}
          <span className="dashboard-week-end-place">
            {end === null
              ? event.location
              : translate("calendar.event.timeAndPlace", {
                  time: end,
                  location: event.location,
                })}
          </span>
        </span>
        <MyResponse
          translate={translate}
          response={event.myResponse}
          isRestricted={isRestricted}
        />
      </Link>
    </li>
  );
}

function DayEvents({
  translate,
  day,
  today,
  isRestricted,
}: {
  readonly translate: Translator;
  readonly day: WeekDay;
  readonly today: string;
  readonly isRestricted: boolean;
}): React.JSX.Element {
  const dayName = formatPanelDay(translate.locale, day.date);
  if (day.events.length === 0) {
    return (
      <p className="dashboard-week-empty">
        {translate("dashboard.week.empty", { day: dayName })}
      </p>
    );
  }
  return (
    <ul
      className="dashboard-week-events"
      aria-label={translate("dashboard.week.events", { day: dayName })}
    >
      {day.events.map((event) => (
        <EventRow
          key={event.id}
          translate={translate}
          event={event}
          today={today}
          isRestricted={isRestricted}
        />
      ))}
    </ul>
  );
}

function WeekDays({
  translate,
  events,
  today,
  nextUpStartsOn,
  isRestricted,
}: {
  readonly translate: Translator;
  readonly events: readonly WeekEvent[];
  readonly today: string;
  readonly nextUpStartsOn: string | null;
  readonly isRestricted: boolean;
}): React.JSX.Element {
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const days = spreadWeekByDay(events, today);
  const selectedDate = chosenDate ?? pickDefaultWeekDay(days, nextUpStartsOn);
  const selectedDay = days.find((day) => day.date === selectedDate);
  return (
    <>
      <DayStrip
        translate={translate}
        days={days}
        selectedDate={selectedDate}
        onSelect={setChosenDate}
      />
      {selectedDay === undefined ? null : (
        <DayEvents
          translate={translate}
          day={selectedDay}
          today={today}
          isRestricted={isRestricted}
        />
      )}
    </>
  );
}

export function DashboardWeek({
  translate,
  week,
  today,
  nextUpStartsOn,
  isRestricted,
  onRetry,
}: {
  readonly translate: Translator;
  readonly week: Week;
  /** El día del club (YYYY-MM-DD) en que se pintó el inicio. */
  readonly today: string;
  /** El día en que empieza el Próximo, o null si no hay. */
  readonly nextUpStartsOn: string | null;
  /** Sin la membresía al día no se ofrece "Responder". */
  readonly isRestricted: boolean;
  /** Vuelve a pedir el inicio cuando la semana no se pudo leer. */
  readonly onRetry: () => void;
}): React.JSX.Element {
  const titleId = useId();
  return (
    <section className="dashboard-week" aria-labelledby={titleId}>
      <header className="dashboard-panel-header">
        <h2 id={titleId}>{translate("dashboard.week.title")}</h2>
        <Link href={CALENDAR_PATH} className="dashboard-panel-all">
          {translate("dashboard.week.calendar")}
          <span aria-hidden="true"> →</span>
        </Link>
      </header>
      {week.kind === "week" ? (
        <WeekDays
          translate={translate}
          events={week.events}
          today={today}
          nextUpStartsOn={nextUpStartsOn}
          isRestricted={isRestricted}
        />
      ) : (
        <div className="dashboard-week-unavailable">
          <p>{translate("dashboard.week.unavailable")}</p>
          <button type="button" className="admin-secondary" onClick={onRetry}>
            {translate("dashboard.retry")}
          </button>
        </div>
      )}
    </section>
  );
}
