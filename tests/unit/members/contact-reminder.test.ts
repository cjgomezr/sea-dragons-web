import { describe, expect, it } from "vitest";
import {
  contactReminderOf,
  isDismissibleReminder,
} from "@/lib/members/contact-reminder";
import type { EmergencyContact } from "@/lib/members/profile-contact";

/**
 * Qué aviso le toca a un socio según los datos de contacto que le faltan
 * (#498, RF-2 del PRD de E19). El contacto de emergencia es obligatorio pero
 * no bloquea nada; el teléfono propio se puede dejar sin poner.
 */

const SISTER: EmergencyContact = {
  name: "Lucía Contacto",
  phone: "0412 999 888",
  relationship: "Hermana",
};

describe("contactReminderOf", () => {
  it("pide los dos cuando no tiene ni teléfono ni contacto", () => {
    expect(contactReminderOf({ phone: null, emergencyContact: null })).toBe(
      "both",
    );
  });

  it("pide el contacto cuando tiene teléfono y no contacto", () => {
    expect(
      contactReminderOf({ phone: "0412 345 678", emergencyContact: null }),
    ).toBe("emergency_contact");
  });

  it("pide el teléfono cuando tiene contacto y no teléfono", () => {
    expect(contactReminderOf({ phone: null, emergencyContact: SISTER })).toBe(
      "phone",
    );
  });

  it("no pide nada cuando tiene los dos", () => {
    expect(
      contactReminderOf({ phone: "0412 345 678", emergencyContact: SISTER }),
    ).toBe("none");
  });
});

describe("isDismissibleReminder", () => {
  it("deja cerrar sólo el aviso del teléfono", () => {
    expect(isDismissibleReminder("phone")).toBe(true);
  });

  it.each(["emergency_contact", "both"] as const)(
    "no deja cerrar %s: falta el contacto de emergencia",
    (reminder) => {
      expect(isDismissibleReminder(reminder)).toBe(false);
    },
  );
});
