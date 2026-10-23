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
 * La franja de lo que falta en el perfil (#771, D8 del PRD de E30; #861, D13
 * del de E33): cuenta el contacto de emergencia, el teléfono, el país, la
 * posición (sólo si el club ofrece alguna), la experiencia y el género. El
 * nombre y el correo los tiene siempre, así que cuentan como hechos.
 */
describe("profileCompletenessOf", () => {
  const WITH_POSITIONS = { hasActivePositions: true } as const;
  const WITHOUT_POSITIONS = { hasActivePositions: false } as const;
  const COMPLETE = {
    country: "AU",
    phone: "0412 345 678",
    emergencyContact: SISTER,
    positionId: "90000000-0000-4000-8000-000000000001",
    experienceLevel: "Intermediate",
    gender: "female",
  } as const;
  const NO_PLAYER_DATA = {
    ...COMPLETE,
    positionId: null,
    experienceLevel: null,
    gender: null,
  } as const;

  it("con todo, no falta nada y está al 100", () => {
    expect(profileCompletenessOf(COMPLETE, WITH_POSITIONS)).toEqual({
      missing: [],
      percent: 100,
    });
  });

  it("sin contacto de emergencia, falta ese y está al 88", () => {
    expect(
      profileCompletenessOf(
        { ...COMPLETE, emergencyContact: null },
        WITH_POSITIONS,
      ),
    ).toEqual({ missing: ["emergency_contact"], percent: 88 });
  });

  it("sin contacto ni teléfono, faltan los dos y está al 75", () => {
    expect(
      profileCompletenessOf(
        { ...COMPLETE, phone: null, emergencyContact: null },
        WITH_POSITIONS,
      ),
    ).toEqual({ missing: ["emergency_contact", "phone"], percent: 75 });
  });

  it("sin posición, experiencia ni género, los pide después del país", () => {
    expect(
      profileCompletenessOf(
        { ...NO_PLAYER_DATA, country: null },
        WITH_POSITIONS,
      ),
    ).toEqual({
      missing: ["country", "position", "experience_level", "gender"],
      percent: 50,
    });
  });

  it("sin nada, lo pide todo en orden y está al 25", () => {
    expect(
      profileCompletenessOf(
        {
          ...NO_PLAYER_DATA,
          country: null,
          phone: null,
          emergencyContact: null,
        },
        WITH_POSITIONS,
      ),
    ).toEqual({
      missing: [
        "emergency_contact",
        "phone",
        "country",
        "position",
        "experience_level",
        "gender",
      ],
      percent: 25,
    });
  });

  it("en un club sin posiciones activas, no pide la posición ni la cuenta", () => {
    expect(profileCompletenessOf(NO_PLAYER_DATA, WITHOUT_POSITIONS)).toEqual({
      missing: ["experience_level", "gender"],
      percent: 71,
    });
  });

  it("en un club sin posiciones activas, con lo demás completo está al 100", () => {
    expect(
      profileCompletenessOf(
        { ...COMPLETE, positionId: null },
        WITHOUT_POSITIONS,
      ),
    ).toEqual({ missing: [], percent: 100 });
  });
});
