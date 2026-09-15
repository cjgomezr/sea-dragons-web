import { describe, expect, it, vi } from "vitest";
import {
  type AuthIdentityGateway,
  type ConfirmationEmailGateway,
  type ConfirmationEmailOutcome,
  type IdentityCreation,
  IdentityCreationError,
  type MemberDirectory,
  MemberRecordError,
  type NewMemberRow,
  type RequestedConfirmationEmail,
  type RegistrationReceipt,
  RegistrationValidationError,
  prepareRegistration,
} from "@/lib/auth/register-member";
import type { RegistrationRequest } from "@/lib/auth/registration";

const NOW = new Date("2026-09-12T03:00:00.000Z");
const CLUB_ID = "6f1d2c3b-4a59-4e6f-8b70-1c2d3e4f5a6b";
const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const APP_URL = "https://victoria-seadragons.vercel.app/api/v1/auth/register";

function requestWith(
  overrides: Partial<RegistrationRequest> = {},
): RegistrationRequest {
  return {
    fullName: "Nerea Silva",
    email: "Nerea@Example.Test",
    country: "AU",
    password: "bajoelagua",
    membershipType: "Full",
    dateOfBirth: "1994-03-02",
    ...overrides,
  };
}

type Doubles = {
  readonly identities: AuthIdentityGateway;
  readonly members: MemberDirectory;
  readonly confirmationEmail: ConfirmationEmailGateway;
  readonly insertedRows: NewMemberRow[];
  readonly deletedUserIds: string[];
  readonly confirmationEmailsRequested: string[];
  readonly confirmationAppUrls: string[];
  readonly calls: string[];
};

type DoubleOptions = {
  readonly identityCreation?: IdentityCreation;
  readonly createIdentityFails?: Error;
  readonly insertMemberFails?: Error;
  readonly deleteIdentityFails?: Error;
  readonly confirmationEmail?: RequestedConfirmationEmail;
};

function doubles(options: DoubleOptions = {}): Doubles {
  const insertedRows: NewMemberRow[] = [];
  const deletedUserIds: string[] = [];
  const confirmationEmailsRequested: string[] = [];
  const confirmationAppUrls: string[] = [];
  const calls: string[] = [];

  return {
    calls,
    insertedRows,
    deletedUserIds,
    confirmationEmailsRequested,
    confirmationAppUrls,
    identities: {
      async createIdentity() {
        calls.push("createIdentity");
        if (options.createIdentityFails) {
          throw options.createIdentityFails;
        }
        return options.identityCreation ?? { kind: "created", userId: USER_ID };
      },
      async deleteIdentity(userId) {
        if (options.deleteIdentityFails) {
          throw options.deleteIdentityFails;
        }
        deletedUserIds.push(userId);
      },
    },
    members: {
      async insertMember(row) {
        calls.push("insertMember");
        if (options.insertMemberFails) {
          throw options.insertMemberFails;
        }
        insertedRows.push(row);
      },
    },
    confirmationEmail: {
      async requestConfirmationEmail(email, appUrl) {
        calls.push("requestConfirmationEmail");
        confirmationEmailsRequested.push(email);
        confirmationAppUrls.push(appUrl);
        return options.confirmationEmail ?? { kind: "requested" };
      },
    },
  };
}

function prepare(
  given: Doubles,
  request: RegistrationRequest = requestWith(),
): ReturnType<typeof prepareRegistration> {
  return prepareRegistration(given, {
    request,
    clubId: CLUB_ID,
    now: NOW,
    appUrl: APP_URL,
  });
}

/** Prepara el registro y corre en el acto el trabajo que la ruta deja para
 * después de responder. */
async function register(
  given: Doubles,
  request: RegistrationRequest = requestWith(),
): Promise<{
  readonly receipt: RegistrationReceipt;
  readonly confirmationEmail: ConfirmationEmailOutcome;
}> {
  const pending = prepare(given, request);
  return {
    receipt: pending.receipt,
    confirmationEmail: await pending.deliver(),
  };
}

describe("registro con entrega diferida", () => {
  it("preparar el registro no crea la identidad, ni la fila, ni pide el correo", () => {
    const given = doubles();

    prepare(given);

    expect(given.calls).toEqual([]);
  });

  it("al entregar crea la identidad, escribe la fila y pide el correo, en ese orden", async () => {
    const given = doubles();

    await prepare(given).deliver();

    expect(given.calls).toEqual([
      "createIdentity",
      "insertMember",
      "requestConfirmationEmail",
    ]);
  });

  it("el recibo está listo antes de entregar y es el mismo con una dirección ya registrada", () => {
    const nuevo = prepare(doubles());
    const repetido = prepare(
      doubles({ identityCreation: { kind: "already_registered" } }),
    );

    expect(repetido.receipt).toEqual(nuevo.receipt);
  });

  it("una solicitud inválida falla al preparar, antes de que haya nada que entregar", () => {
    const given = doubles();

    expect(() => prepare(given, requestWith({ password: "corta" }))).toThrow(
      RegistrationValidationError,
    );
    expect(given.calls).toEqual([]);
  });
});

describe("registro", () => {
  it("crea la cuenta con el rol Player y el tipo de membresía elegido", async () => {
    const given = doubles();

    await register(given, requestWith({ membershipType: "Student" }));

    expect(given.insertedRows).toEqual([
      {
        club_id: CLUB_ID,
        user_id: USER_ID,
        full_name: "Nerea Silva",
        email: "nerea@example.test",
        country: "AU",
        date_of_birth: "1994-03-02",
        membership_type: "Student",
        role: "Player",
        account_status: "incomplete",
      },
    ]);
  });

  it("la cuenta nace incomplete con el correo sin confirmar", async () => {
    const given = doubles();

    const result = await register(given);

    expect(given.insertedRows[0]?.account_status).toBe("incomplete");
    expect(result.receipt.outcome).toBe("confirmation_pending");
  });

  it("pide el correo de confirmación con la dirección ya normalizada", async () => {
    const given = doubles();

    const result = await register(given);

    expect(given.confirmationEmailsRequested).toEqual(["nerea@example.test"]);
    expect(result.confirmationEmail).toEqual({ kind: "requested" });
  });

  // El enlace del correo tiene que volver al despliegue que atendió el
  // registro: un preview no puede mandar a producción a confirmar.
  it("pide el correo con la dirección de la aplicación que atendió el registro", async () => {
    const given = doubles();

    await register(given);

    expect(given.confirmationAppUrls).toEqual([APP_URL]);
  });

  it("el recibo sólo lleva el desenlace neutro y la dirección", async () => {
    const result = await register(doubles());

    expect(result.receipt).toEqual({
      outcome: "confirmation_pending",
      email: "nerea@example.test",
    });
  });

  it("rechaza una solicitud inválida sin tocar ningún servicio", async () => {
    const given = doubles();
    const createIdentity = vi.spyOn(given.identities, "createIdentity");

    await expect(
      register(given, requestWith({ password: "corta" })),
    ).rejects.toBeInstanceOf(RegistrationValidationError);
    expect(createIdentity).not.toHaveBeenCalled();
  });

  it("con un correo ya registrado responde lo mismo que con uno nuevo", async () => {
    const nuevo = await register(doubles());
    const repetido = await register(
      doubles({ identityCreation: { kind: "already_registered" } }),
    );

    expect(repetido.receipt).toEqual(nuevo.receipt);
  });

  it("con un correo ya registrado no crea una segunda cuenta ni pide el correo", async () => {
    const given = doubles({
      identityCreation: { kind: "already_registered" },
    });

    await register(given);

    expect(given.insertedRows).toEqual([]);
    expect(given.confirmationEmailsRequested).toEqual([]);
  });

  it("si el servicio de autenticación falla, el error sube con contexto y no queda fila de miembro", async () => {
    const given = doubles({
      createIdentityFails: new Error("auth service unavailable"),
    });

    await expect(register(given)).rejects.toThrow(/auth service unavailable/);
    expect(given.insertedRows).toEqual([]);
  });

  it("el error del servicio de autenticación conserva la causa original", async () => {
    const cause = new Error("auth service unavailable");
    const given = doubles({ createIdentityFails: cause });

    await expect(register(given)).rejects.toMatchObject({
      name: IdentityCreationError.name,
      cause,
    });
  });

  it("si la fila de miembro falla, borra la identidad para no dejarla huérfana", async () => {
    const given = doubles({
      insertMemberFails: new Error("violates check constraint"),
    });

    await expect(register(given)).rejects.toBeInstanceOf(MemberRecordError);
    expect(given.deletedUserIds).toEqual([USER_ID]);
  });

  it("si el borrado de compensación también falla, el error lo dice en vez de taparlo", async () => {
    const given = doubles({
      insertMemberFails: new Error("violates check constraint"),
      deleteIdentityFails: new Error("admin api down"),
    });

    await expect(register(given)).rejects.toMatchObject({
      name: MemberRecordError.name,
      identityRollback: "orphaned",
    });
  });

  it("no pide el correo de confirmación si la fila de miembro no se pudo escribir", async () => {
    const given = doubles({
      insertMemberFails: new Error("violates check constraint"),
    });

    await expect(register(given)).rejects.toBeInstanceOf(MemberRecordError);
    expect(given.confirmationEmailsRequested).toEqual([]);
  });

  it("el error de validación lleva los campos que fallaron", async () => {
    const given = doubles();

    await expect(
      register(given, requestWith({ country: "", password: "corta" })),
    ).rejects.toMatchObject({
      issues: [
        { field: "country", message: expect.any(String) },
        { field: "password", message: expect.any(String) },
      ],
    });
  });
});

const FAILED_SENDS: Readonly<Record<string, RequestedConfirmationEmail>> = {
  "rechazo 400": { kind: "failed", reason: "400: Email address is invalid" },
  "rechazo 429": {
    kind: "rate_limited",
    reason: "429: email rate limit exceeded",
  },
};

describe("cuenta tras un envío fallido", () => {
  it.each(Object.entries(FAILED_SENDS))(
    "con un %s la identidad y la fila del socio se conservan",
    async (_sendResult, confirmationEmail) => {
      const given = doubles({ confirmationEmail });

      await register(given);

      expect(given.insertedRows).toHaveLength(1);
      expect(given.deletedUserIds).toEqual([]);
    },
  );

  it.each(Object.entries(FAILED_SENDS))(
    "con un %s el recibo es el mismo que con un envío que sale",
    async (_sendResult, confirmationEmail) => {
      const sent = await register(doubles());
      const failed = await register(doubles({ confirmationEmail }));

      expect(JSON.stringify(failed.receipt)).toBe(JSON.stringify(sent.receipt));
    },
  );

  it("conserva el motivo del fallo para quien lo registre", async () => {
    const confirmationEmail = FAILED_SENDS["rechazo 429"];

    const result = await register(doubles({ confirmationEmail }));

    expect(result.confirmationEmail).toEqual(confirmationEmail);
  });
});
