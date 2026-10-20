import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { ChatCircleDots } from "@phosphor-icons/react/dist/ssr/ChatCircleDots";
import { ClipboardText } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { UserSwitch } from "@phosphor-icons/react/dist/ssr/UserSwitch";
import { UsersThree } from "@phosphor-icons/react/dist/ssr/UsersThree";
import Link from "next/link";
import { useId } from "react";
import { Icon } from "@/components/Icon";
import type { SeasonAttendance } from "@/lib/attendance/season-attendance";
import {
  ATTENDANCE_PATH,
  ATTENDANCE_SESSION_QUERY_PARAM,
  CALENDAR_EVENT_QUERY_PARAM,
  CALENDAR_PATH,
  DIRECTORY_PATH,
  NEWS_PATH,
  TEAMS_EVENT_QUERY_PARAM,
  TEAMS_PATH,
} from "@/lib/auth/routes";
import type {
  ClubAttendanceTrend,
  ClubMembersNumbers,
  ClubNumbers,
  ClubUnreadNews,
  DashboardMe,
  DashboardTodo,
  DashboardTodos,
} from "@/lib/dashboard/dashboard";
import {
  formatDashboardDay,
  formatNumber,
  formatPercent,
} from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";

/**
 * La columna de gestión del inicio (#750, RF-6, D3, D9, D11 y D13 del PRD de
 * E27): "Pendientes" y "Números del club", que Admin, Coach y Committee ven
 * en lugar de la del Player. Cada pendiente ya llega filtrado por quien
 * puede resolverlo (D9), así que su enlace no se vuelve a comprobar aquí.
 * Las celdas de los números sí: enlazan sólo si el rol abre su sección.
 *
 * Por debajo de las dos columnas, el CSS deshace esta columna y la de
 * "Próximo" para que Pendientes vaya justo bajo "Próximo" y los números
 * bajo "Esta semana" (#2a del handoff).
 */

/** Las secciones a las que lleva una celda de los números del club, según
 * lo que el rol de quien mira puede abrir. */
export type OpenableSections = {
  readonly attendance: boolean;
  readonly directory: boolean;
  readonly news: boolean;
};

type TodoTone = "accent" | "danger" | "warning" | "neutral";

type TodoRowContent = {
  readonly tone: TodoTone;
  readonly glyph: PhosphorGlyph;
  readonly title: string;
  readonly detail: string;
  readonly action: string;
  readonly href: string;
};

function attendanceSheetHref(eventId: string): string {
  return `${ATTENDANCE_PATH}?${ATTENDANCE_SESSION_QUERY_PARAM}=${eventId}`;
}

function teamBuilderHref(eventId: string): string {
  return `${TEAMS_PATH}?${TEAMS_EVENT_QUERY_PARAM}=${eventId}`;
}

/** "No han respondido" es siempre del próximo evento: el calendario lo
 * abre entre los próximos, sin pedir los pasados. */
function upcomingEventHref(eventId: string): string {
  return `${CALENDAR_PATH}?${CALENDAR_EVENT_QUERY_PARAM}=${eventId}`;
}

function describeTodo(
  translate: Translator,
  todo: DashboardTodo,
): TodoRowContent {
  switch (todo.kind) {
    case "role_requests":
      return {
        tone: "accent",
        glyph: UserSwitch,
        title: translate("dashboard.todos.roleRequests", { count: todo.count }),
        detail: translate("dashboard.todos.roleRequests.detail"),
        action: translate("dashboard.todos.roleRequests.action"),
        href: DIRECTORY_PATH,
      };
    case "attendance_missing":
      return {
        tone: "danger",
        glyph: ClipboardText,
        title: translate("dashboard.todos.attendance"),
        detail: translate("dashboard.todos.attendance.detail", {
          event: todo.title,
          date: formatDashboardDay(translate.locale, todo.startsOn),
        }),
        action: translate("dashboard.todos.attendance.action"),
        href: attendanceSheetHref(todo.eventId),
      };
    case "teams_unpublished":
      return {
        tone: "warning",
        glyph: UsersThree,
        title: translate("dashboard.todos.teams"),
        detail: translate("dashboard.todos.teams.detail", {
          event: todo.title,
        }),
        action: translate("dashboard.todos.teams.action"),
        href: teamBuilderHref(todo.eventId),
      };
    case "no_reply":
      return {
        tone: "neutral",
        glyph: ChatCircleDots,
        title: translate("dashboard.todos.noReply", { count: todo.count }),
        detail: todo.title,
        action: translate("dashboard.todos.noReply.action"),
        href: upcomingEventHref(todo.eventId),
      };
  }
}

/** Una fila de Pendientes. En el móvil la acción se queda en la flecha y
 * toda la fila responde al toque; el texto sigue siendo su nombre. */
function TodoRow({
  content,
}: {
  readonly content: TodoRowContent;
}): React.JSX.Element {
  const titleId = useId();
  return (
    <li className="dashboard-todo">
      <span
        className={`dashboard-todo-icon dashboard-todo-icon-${content.tone}`}
        aria-hidden="true"
      >
        <Icon glyph={content.glyph} />
      </span>
      <div className="dashboard-todo-text">
        <p id={titleId} className="dashboard-todo-title">
          {content.title}
        </p>
        <p className="dashboard-todo-detail">{content.detail}</p>
      </div>
      <Link
        href={content.href}
        className="dashboard-todo-action"
        aria-describedby={titleId}
      >
        <span className="dashboard-todo-action-label">{content.action}</span>
        <Icon glyph={CaretRight} />
      </Link>
    </li>
  );
}

function CardFailure({
  translate,
  message,
  onRetry,
}: {
  readonly translate: Translator;
  readonly message: string;
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="dashboard-management-failure">
      <p>{message}</p>
      <button type="button" className="admin-secondary" onClick={onRetry}>
        {translate("dashboard.retry")}
      </button>
    </div>
  );
}

function TodoList({
  translate,
  todos,
}: {
  readonly translate: Translator;
  readonly todos: readonly DashboardTodo[];
}): React.JSX.Element {
  if (todos.length === 0) {
    return (
      <p className="dashboard-todos-empty">
        {translate("dashboard.todos.empty")}
      </p>
    );
  }
  return (
    <ul className="dashboard-todos-list">
      {todos.map((todo) => (
        <TodoRow key={todo.kind} content={describeTodo(translate, todo)} />
      ))}
    </ul>
  );
}

function TodosCard({
  translate,
  todos,
  onRetry,
}: {
  readonly translate: Translator;
  readonly todos: DashboardTodos;
  readonly onRetry: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const isLoaded = !("kind" in todos);
  return (
    <section className="dashboard-todos" aria-labelledby={titleId}>
      <div className="dashboard-todos-header">
        <h2 id={titleId}>{translate("dashboard.todos.title")}</h2>
        {isLoaded && todos.length > 0 ? (
          <span className="dashboard-todos-badge">
            {formatNumber(translate.locale, todos.length)}
          </span>
        ) : null}
      </div>
      {isLoaded ? (
        <TodoList translate={translate} todos={todos} />
      ) : (
        <CardFailure
          translate={translate}
          message={translate("dashboard.todos.unavailable")}
          onRetry={onRetry}
        />
      )}
    </section>
  );
}

type TrendDirection = "up" | "down";

/** Cuánto cambió la asistencia del club frente a los 30 días anteriores
 * (D11). Igual, o sin uno de los dos datos, no hay comparación. */
type AttendanceChange = {
  readonly direction: TrendDirection;
  readonly points: number;
};

type ClubCellContent = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly caption: string | null;
  readonly trend: TrendDirection | null;
  /** Sin destino la celda es texto. */
  readonly href: string | null;
};

const TREND_KEYS = {
  up: "dashboard.club.attendance.up",
  down: "dashboard.club.attendance.down",
} as const satisfies Record<TrendDirection, MessageKey>;

function attendanceChangeOf({
  percent,
  previousPercent,
}: ClubAttendanceTrend): AttendanceChange | null {
  if (percent === null || previousPercent === null) {
    return null;
  }
  if (percent === previousPercent) {
    return null;
  }
  return {
    direction: percent > previousPercent ? "up" : "down",
    points: Math.abs(percent - previousPercent),
  };
}

function describeClubAttendance(
  translate: Translator,
  attendance: ClubAttendanceTrend,
  isLinked: boolean,
): ClubCellContent {
  const change = attendanceChangeOf(attendance);
  return {
    key: "club-attendance",
    label: translate("dashboard.club.attendance"),
    value:
      attendance.percent === null
        ? translate("dashboard.tile.noData")
        : formatPercent(translate.locale, attendance.percent),
    caption:
      change === null
        ? null
        : translate(TREND_KEYS[change.direction], { points: change.points }),
    trend: change === null ? null : change.direction,
    href: isLinked ? ATTENDANCE_PATH : null,
  };
}

function describeMyAttendance(
  translate: Translator,
  { percent, attended, sessions }: SeasonAttendance,
): ClubCellContent {
  return {
    key: "my-attendance",
    label: translate("dashboard.attendance.title"),
    value: formatPercent(translate.locale, percent),
    caption: translate("dashboard.attendance.sessions", {
      attended,
      count: sessions,
    }),
    trend: null,
    href: null,
  };
}

function describeMembers(
  translate: Translator,
  members: ClubMembersNumbers,
  isLinked: boolean,
): ClubCellContent {
  return {
    key: "members",
    label: translate("dashboard.club.members"),
    value: formatNumber(translate.locale, members.active),
    caption: translate("dashboard.club.members.caption", {
      count: members.joinedThisMonth,
    }),
    trend: null,
    href: isLinked ? DIRECTORY_PATH : null,
  };
}

function describeUnreadNews(
  translate: Translator,
  unreadNews: ClubUnreadNews,
  isLinked: boolean,
): ClubCellContent {
  return {
    key: "unread-news",
    label: translate("dashboard.club.unreadNews"),
    value: formatNumber(translate.locale, unreadNews.count),
    caption: translate("dashboard.club.unreadNews.caption", {
      count: unreadNews.announcements,
    }),
    trend: null,
    href: isLinked ? NEWS_PATH : null,
  };
}

type ClubCellsRequest = {
  readonly club: ClubNumbers;
  readonly myAttendance: DashboardMe["attendance"];
  readonly openableSections: OpenableSections;
};

/** Las celdas en el orden del handoff, o null si falta alguna lectura: la
 * tarjeta entera dice entonces que no se pudo cargar. "Mi asistencia" se
 * esconde a quien no tiene sesiones elegibles (D13). */
function describeClubCells(
  translate: Translator,
  { club, myAttendance, openableSections }: ClubCellsRequest,
): readonly ClubCellContent[] | null {
  const { attendance, members, unreadNews } = club;
  if (
    "kind" in attendance ||
    "kind" in members ||
    "kind" in unreadNews ||
    (myAttendance !== null && "kind" in myAttendance)
  ) {
    return null;
  }
  return [
    describeClubAttendance(translate, attendance, openableSections.attendance),
    ...(myAttendance === null
      ? []
      : [describeMyAttendance(translate, myAttendance)]),
    describeMembers(translate, members, openableSections.directory),
    describeUnreadNews(translate, unreadNews, openableSections.news),
  ];
}

function ClubCellBody({
  cell,
}: {
  readonly cell: ClubCellContent;
}): React.JSX.Element {
  return (
    <>
      <span className="dashboard-club-label">{cell.label}</span>
      <span className="dashboard-club-value">{cell.value}</span>
      {cell.caption === null ? null : (
        <span
          className={
            cell.trend === null
              ? "dashboard-club-caption"
              : `dashboard-club-caption dashboard-club-trend-${cell.trend}`
          }
        >
          {cell.caption}
        </span>
      )}
    </>
  );
}

function ClubCell({
  cell,
}: {
  readonly cell: ClubCellContent;
}): React.JSX.Element {
  return (
    <li className="dashboard-club-cell">
      {cell.href === null ? (
        <div className="dashboard-club-cell-body">
          <ClubCellBody cell={cell} />
        </div>
      ) : (
        <Link href={cell.href} className="dashboard-club-cell-body">
          <ClubCellBody cell={cell} />
        </Link>
      )}
    </li>
  );
}

function ClubNumbersCard({
  translate,
  onRetry,
  ...request
}: ClubCellsRequest & {
  readonly translate: Translator;
  readonly onRetry: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const cells = describeClubCells(translate, request);
  return (
    <section className="dashboard-club" aria-labelledby={titleId}>
      <h2 id={titleId} className="visually-hidden">
        {translate("dashboard.club.title")}
      </h2>
      {cells === null ? (
        <CardFailure
          translate={translate}
          message={translate("dashboard.club.unavailable")}
          onRetry={onRetry}
        />
      ) : (
        <ul className="dashboard-club-grid">
          {cells.map((cell) => (
            <ClubCell key={cell.key} cell={cell} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function ManagementColumn({
  translate,
  todos,
  club,
  myAttendance,
  openableSections,
  onRetry,
}: ClubCellsRequest & {
  readonly translate: Translator;
  readonly todos: DashboardTodos;
  /** Vuelve a pedir el inicio cuando una de las dos tarjetas no cargó. */
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="dashboard-management-column">
      <TodosCard translate={translate} todos={todos} onRetry={onRetry} />
      <ClubNumbersCard
        translate={translate}
        club={club}
        myAttendance={myAttendance}
        openableSections={openableSections}
        onRetry={onRetry}
      />
    </div>
  );
}
