import type { Translator } from "@/lib/i18n/translator";
import type { MemberRecordReading } from "@/lib/members/member-record";
import { ContactActions, type ReachableContact } from "./ContactActions";

/**
 * Lo que sale a la derecha de la cabecera de la ficha (#775, RF-2 y RF-6 del
 * PRD de E30): los botones de 40 px para escribir, llamar y llamar al
 * contacto de emergencia, y el ⋯ del Admin.
 *
 * Qué botones salen lo decide la vista que trajo la API (D3): el Admin y el
 * Committee tienen los tres; el Coach, que no ve el correo ni el teléfono,
 * sólo el de emergencia. El ⋯ sólo sale en la vista del Admin, aunque quien
 * pinta la ficha lo pase.
 */

function reachableContactOf(reading: MemberRecordReading): ReachableContact {
  if (reading.view === "coach") {
    return { kind: "emergency", emergencyContact: reading.emergencyContact };
  }
  return {
    kind: "full",
    email: reading.email,
    phone: reading.phone,
    emergencyContact: reading.emergencyContact,
  };
}

export function MemberRecordActions({
  translate,
  reading,
  adminMenu,
}: {
  translate: Translator;
  reading: MemberRecordReading;
  /** El ⋯ con las acciones del Admin. */
  adminMenu: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="member-record-actions">
      <ContactActions
        translate={translate}
        contact={reachableContactOf(reading)}
        fullName={reading.fullName}
        label={translate("memberRecord.contactActions", {
          name: reading.fullName,
        })}
        className="member-record-contact"
        labelMissing={(action) =>
          translate("memberRecord.contactMissing", { action })
        }
      />
      {reading.view === "admin" ? adminMenu : null}
    </div>
  );
}
