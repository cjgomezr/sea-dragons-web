import { describe, expect, it } from "vitest";
import type {
  IdentityConfirmationReader,
  MemberAccountStore,
} from "@/lib/auth/account-activation";
import {
  EMAIL_CONFIRMATION_OTP_TYPES,
  type EmailConfirmation,
  type EmailConfirmationGateway,
  confirmEmailAndActivate,
  parseEmailConfirmationOtpType,
} from "@/lib/auth/email-confirmation";

const NOW = new Date("2026-09-12T03:00:00.000Z");
const MEMBER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const TOKEN_HASH = "un-token-de-confirmacion";

type Doubles = {
  readonly confirmations: EmailConfirmationGateway;
  readonly accounts: MemberAccountStore;
  readonly identities: IdentityConfirmationReader;
  readonly written: string[];
};

function doubles(options: {
  readonly confirmation: EmailConfirmation;
  readonly country?: string | null;
}): Doubles {
  const written: string[] = [];
  return {
    written,
    confirmations: {
      async confirmEmail() {
        return options.confirmation;
      },
    },
    accounts: {
      async findByUserId() {
        return {
          memberId: MEMBER_ID,
          accountStatus: "incomplete",
          profile: {
            country: options.country === undefined ? "AU" : options.country,
            dateOfBirth: "1994-03-02",
            membershipType: "Full",
            guardianConsentAt: null,
          },
        };
      },
      async updateAccountStatus(memberId, status) {
        written.push(`${memberId}:${status}`);
      },
    },
    // El enlace de confirmación es justo lo que deja el correo confirmado, así
    // que después de canjearlo la identidad siempre lo está.
    identities: {
      async isEmailConfirmed() {
        return true;
      },
    },
  };
}

describe("tipo de enlace de confirmación", () => {
  it("acepta los tipos que emite Supabase para confirmar un correo", () => {
    for (const type of EMAIL_CONFIRMATION_OTP_TYPES) {
      expect(parseEmailConfirmationOtpType(type)).toBe(type);
    }
  });

  it("rechaza un tipo que no confirma ningún correo", () => {
    expect(parseEmailConfirmationOtpType("recovery")).toBeNull();
  });

  it("rechaza un tipo ausente", () => {
    expect(parseEmailConfirmationOtpType(null)).toBeNull();
  });
});

describe("confirmación del correo", () => {
  it("activa la cuenta cuyo único pendiente era la confirmación", async () => {
    const given = doubles({
      confirmation: { kind: "confirmed", userId: USER_ID },
    });

    const result = await confirmEmailAndActivate(given, {
      tokenHash: TOKEN_HASH,
      type: "signup",
      now: NOW,
    });

    expect(result).toEqual({ kind: "activated" });
    expect(given.written).toEqual([`${MEMBER_ID}:active`]);
  });

  it("deja la cuenta incompleta si además del correo le falta otro dato", async () => {
    const given = doubles({
      confirmation: { kind: "confirmed", userId: USER_ID },
      country: null,
    });

    const result = await confirmEmailAndActivate(given, {
      tokenHash: TOKEN_HASH,
      type: "signup",
      now: NOW,
    });

    expect(result).toEqual({ kind: "confirmed_still_incomplete" });
    expect(given.written).toEqual([]);
  });

  it("no toca ninguna cuenta si el enlace no vale", async () => {
    const given = doubles({
      confirmation: { kind: "rejected", reason: "Token has expired" },
    });

    const result = await confirmEmailAndActivate(given, {
      tokenHash: TOKEN_HASH,
      type: "signup",
      now: NOW,
    });

    expect(result).toEqual({ kind: "rejected", reason: "Token has expired" });
    expect(given.written).toEqual([]);
  });
});
