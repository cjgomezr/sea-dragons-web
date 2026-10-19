import { describe, expect, it } from "vitest";
import {
  contactReminderOf,
  profileCompletenessOf,
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

/**
 * La franja de lo que falta en el perfil (#771, D8 del PRD de E30): cuenta el
 * contacto de emergencia, el teléfono y el país. El nombre y el correo los
 * tiene siempre, así que cuentan como hechos y el porcentaje nunca baja de
 * 40.
 */
describe("profileCompletenessOf", () => {
  const COMPLETE = {
    country: "AU",
    phone: "0412 345 678",
    emergencyContact: SISTER,
  } as const;

  it("con todo, no falta nada y está al 100", () => {
    expect(profileCompletenessOf(COMPLETE)).toEqual({
      missing: [],
      percent: 100,
    });
  });

  it("sin contacto de emergencia, falta ese y está al 80", () => {
    expect(
      profileCompletenessOf({ ...COMPLETE, emergencyContact: null }),
    ).toEqual({ missing: ["emergency_contact"], percent: 80 });
  });

  it("sin contacto ni teléfono, faltan los dos y está al 60", () => {
    expect(
      profileCompletenessOf({
        ...COMPLETE,
        phone: null,
        emergencyContact: null,
      }),
    ).toEqual({ missing: ["emergency_contact", "phone"], percent: 60 });
  });

  it("sin los tres, faltan en ese orden y está al 40", () => {
    expect(
      profileCompletenessOf({
        country: null,
        phone: null,
        emergencyContact: null,
      }),
    ).toEqual({
      missing: ["emergency_contact", "phone", "country"],
      percent: 40,
    });
  });
});
