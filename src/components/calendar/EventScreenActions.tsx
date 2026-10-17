import { CalendarBlank } from "@phosphor-icons/react/dist/ssr/CalendarBlank";
import { DotsThreeVertical } from "@phosphor-icons/react/dist/ssr/DotsThreeVertical";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Repeat } from "@phosphor-icons/react/dist/ssr/Repeat";
import { XCircle } from "@phosphor-icons/react/dist/ssr/XCircle";
import { useEffect, useId, useRef, useState } from "react";
import { BottomSheet } from "@/components/directory/BottomSheet";
import { Icon } from "@/components/Icon";
import type { AgendaEvent } from "@/lib/events/event-agenda";
import { formatPanelDay } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { ManageScope, ManageTarget } from "./event-manage-client";
import { EventDialog } from "./EventDialog";
import {
  CancelConfirmation,
  CancelScopeChoice,
  type CancelStatus,
  type EditingStep,
  type EventManagement,
  type EventOrganizer,
  type OrganizerDetails,
  manageEvent,
} from "./EventOrganizerActions";

/**
 * El ⋯ de la pantalla del evento en el móvil (#656, RF-12 del PRD de E24,
 * "#2b" del handoff) y la hoja que sube, para quien puede editar. En una
 * sesión de una serie la hoja dice "ESTE EVENTO SE REPITE" y ofrece editar
 * solo esa sesión, con su fecha, o esa y las siguientes; en un evento suelto,
 * Editar evento. Debajo, Cancelar evento en rojo y Cerrar.
 *
 * Editar cierra la hoja y abre el mismo diálogo que en escritorio, ya con el
 * alcance elegido. Cancelar se queda en la hoja: en una serie pregunta antes
 * si es solo esta, y siempre pide la misma confirmación que en escritorio.
 * Lo que termina se lo pasa a la agenda, que vuelve a ella y lo anuncia. Al
 * cerrarse la hoja o el diálogo, el foco vuelve al ⋯.
 */

type SheetStep =
  | { readonly kind: "menu" }
  | { readonly kind: "choosingCancelScope" }
  | {
      readonly kind: "confirmingCancel";
      readonly target: ManageTarget;
      readonly status: CancelStatus;
    };

const MENU: SheetStep = { kind: "menu" };

/** Una fila de la hoja: el icono, su nombre y, si la lleva, la pista de
 * debajo como descripción. */
function SheetRow({
  glyph,
  label,
  hint = null,
  isDanger = false,
  onChoose,
}: {
  readonly glyph: Parameters<typeof Icon>[0]["glyph"];
  readonly label: string;
  readonly hint?: string | null;
  readonly isDanger?: boolean;
  readonly onChoose: () => void;
}): React.JSX.Element {
  const labelId = useId();
  const hintId = useId();
  return (
    <button
      type="button"
      className={
        isDanger
          ? "agenda-sheet-action agenda-sheet-action-danger"
          : "agenda-sheet-action"
      }
      aria-labelledby={labelId}
      aria-describedby={hint === null ? undefined : hintId}
      onClick={onChoose}
    >
      <Icon glyph={glyph} />
      <span className="agenda-sheet-action-text">
        <span id={labelId}>{label}</span>
        {hint === null ? null : (
          <span id={hintId} className="agenda-sheet-action-hint">
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

function SheetMenu({
  translate,
  event,
  onEdit,
  onCancel,
}: {
  readonly translate: Translator;
  readonly event: AgendaEvent;
  readonly onEdit: (scope: ManageScope) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const cancelRow = (
    <SheetRow
      glyph={XCircle}
      label={translate("calendar.screen.sheet.cancelEvent")}
      isDanger
      onChoose={onCancel}
    />
  );
  if (event.seriesId === null) {
    return (
      <>
        <SheetRow
          glyph={PencilSimple}
          label={translate("calendar.screen.sheet.editEvent")}
          onChoose={() => onEdit("event")}
        />
        {cancelRow}
      </>
    );
  }
  return (
    <>
      <p className="directory-sheet-label">
        {translate("calendar.screen.sheet.repeats")}
      </p>
      <SheetRow
        glyph={CalendarBlank}
        label={translate("calendar.screen.sheet.editSession")}
        hint={formatPanelDay(translate.locale, event.startsOn)}
        onChoose={() => onEdit("event")}
      />
      <SheetRow
        glyph={Repeat}
        label={translate("calendar.screen.sheet.editFollowing")}
        hint={translate("calendar.screen.sheet.editFollowingHint")}
        onChoose={() => onEdit("series")}
      />
      {cancelRow}
    </>
  );
}

function SheetContent({
  translate,
  event,
  goingCount,
  management,
  onEdit,
  close,
}: {
  readonly translate: Translator;
  readonly event: AgendaEvent;
  readonly goingCount: number;
  readonly management: EventManagement;
  readonly onEdit: (scope: ManageScope) => void;
  readonly close: () => void;
}): React.JSX.Element {
  const [step, setStep] = useState<SheetStep>(MENU);
  const menuRef = useRef<HTMLDivElement>(null);
  const hasLeftMenuRef = useRef(false);
  // Como en el panel: el estado desactiva el botón en el siguiente pintado,
  // pero un doble toque llega antes.
  const isSendingRef = useRef(false);

  // Al volver al menú desde un paso, el botón que lo cambió ya no está: el
  // foco pasa al menú para no quedarse en el aire.
  useEffect(() => {
    if (step.kind === "menu" && hasLeftMenuRef.current) {
      menuRef.current?.focus();
    }
  }, [step]);

  function goTo(next: SheetStep): void {
    hasLeftMenuRef.current = true;
    setStep(next);
  }

  function confirmScope(scope: ManageScope): void {
    goTo({
      kind: "confirmingCancel",
      target: management.targetFor(scope),
      status: { kind: "confirming" },
    });
  }

  async function confirmCancel(target: ManageTarget): Promise<void> {
    if (isSendingRef.current) {
      return;
    }
    isSendingRef.current = true;
    setStep({ kind: "confirmingCancel", target, status: { kind: "sending" } });
    const outcome = await management.cancel(target);
    isSendingRef.current = false;
    if (outcome.kind === "failed") {
      setStep({ kind: "confirmingCancel", target, status: outcome });
    }
  }

  return (
    <>
      {step.kind === "menu" ? (
        <div ref={menuRef} className="agenda-sheet-step" tabIndex={-1}>
          <SheetMenu
            translate={translate}
            event={event}
            onEdit={onEdit}
            onCancel={() =>
              event.seriesId === null
                ? confirmScope("event")
                : goTo({ kind: "choosingCancelScope" })
            }
          />
        </div>
      ) : null}
      {step.kind === "choosingCancelScope" ? (
        <CancelScopeChoice
          translate={translate}
          onChoose={confirmScope}
          onBack={() => goTo(MENU)}
        />
      ) : null}
      {step.kind === "confirmingCancel" ? (
        <CancelConfirmation
          translate={translate}
          scope={step.target.scope}
          goingCount={goingCount}
          status={step.status}
          onConfirm={() => void confirmCancel(step.target)}
          onKeep={() => goTo(MENU)}
        />
      ) : null}
      {step.kind === "menu" ? (
        <button
          type="button"
          className="admin-secondary directory-sheet-cancel"
          onClick={close}
        >
          {translate("calendar.screen.sheet.close")}
        </button>
      ) : null}
    </>
  );
}

export function EventScreenActions({
  translate,
  event,
  details,
  goingCount,
  organizer,
}: {
  readonly translate: Translator;
  readonly event: AgendaEvent;
  readonly details: OrganizerDetails;
  /** Los que van según la fila, que ya cuenta la respuesta propia. */
  readonly goingCount: number;
  readonly organizer: EventOrganizer;
}): React.JSX.Element {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editing, setEditing] = useState<EditingStep | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  // Lo que se eligió editar espera a que la hoja termine de cerrarse: el
  // navegador avisa del cierre más tarde, y si el diálogo ya estuviera
  // abierto, devolver el foco al ⋯ se lo quitaría.
  const pendingEditRef = useRef<EditingStep | null>(null);
  const management = manageEvent(event, details, organizer);
  const label = translate("calendar.screen.more");

  function returnFocus(): void {
    openerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className="agenda-screen-bar-button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={isSheetOpen}
        onClick={() => setIsSheetOpen(true)}
      >
        <Icon glyph={DotsThreeVertical} />
      </button>
      {isSheetOpen ? (
        <BottomSheet
          title={(titleId) => (
            <h2 id={titleId} className="visually-hidden">
              {label}
            </h2>
          )}
          gripLabel={translate("calendar.screen.sheet.grip")}
          onClosed={() => {
            setIsSheetOpen(false);
            const pendingEdit = pendingEditRef.current;
            pendingEditRef.current = null;
            if (pendingEdit === null) {
              returnFocus();
              return;
            }
            setEditing(pendingEdit);
          }}
        >
          {(close) => (
            <SheetContent
              translate={translate}
              event={event}
              goingCount={goingCount}
              management={management}
              onEdit={(scope) => {
                pendingEditRef.current = management.startEditing(scope);
                close();
              }}
              close={close}
            />
          )}
        </BottomSheet>
      ) : null}
      {editing === null ? null : (
        <EventDialog
          translate={translate}
          layout={editing.target.scope}
          initialForm={editing.initialForm}
          currentCoverUrl={details.coverUrl}
          submit={(form) => management.submitEdit(editing, form)}
          onReload={management.reloadSeries}
          onClosed={() => {
            setEditing(null);
            returnFocus();
          }}
        />
      )}
    </>
  );
}
