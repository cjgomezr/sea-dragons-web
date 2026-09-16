import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NewPasswordForm,
  RecoveryLinkUnusable,
} from "@/components/auth/NewPasswordForm";
import {
  PASSWORD_RECOVERY_PATH,
  PASSWORD_RESET_API_PATH,
  SIGN_IN_PATH,
} from "@/lib/auth/routes";
import { describeAuthIssue } from "@/lib/auth/issue-messages";
import { createTranslator } from "@/lib/i18n/translator";
import { validatePasswordField } from "@/lib/auth/registration";

const TOKEN_HASH = "hash-del-enlace";

type FetchCall = { readonly url: string; readonly body: unknown };

const calls: FetchCall[] = [];

function stubApi(response: { status: number; body: unknown }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as unknown });
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

async function submitPassword(password: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Contraseña nueva"), password);
  await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));
}

describe("formulario de contraseña nueva", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("manda la contraseña con el token del enlace y confirma el cambio", async () => {
    stubApi({ status: 200, body: { data: { outcome: "password_changed" } } });
    render(<NewPasswordForm tokenHash={TOKEN_HASH} />);

    await submitPassword("bajoelagua-nueva");

    expect(
      await screen.findByRole("heading", {
        name: "Tu contraseña quedó cambiada",
      }),
    ).toBeInTheDocument();
    expect(calls).toEqual([
      {
        url: PASSWORD_RESET_API_PATH,
        body: { tokenHash: TOKEN_HASH, password: "bajoelagua-nueva" },
      },
    ]);
    expect(screen.getByRole("link", { name: "Entrar" })).toHaveAttribute(
      "href",
      SIGN_IN_PATH,
    );
  });

  it("rechaza la contraseña de 7 caracteres con el mensaje del registro, sin llamar al servidor", async () => {
    stubApi({ status: 200, body: { data: { outcome: "password_changed" } } });
    const rule = validatePasswordField("1234567");
    render(<NewPasswordForm tokenHash={TOKEN_HASH} />);

    await submitPassword("1234567");

    expect(rule.ok).toBe(false);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      rule.ok ? "" : describeAuthIssue(createTranslator("es"), rule.code),
    );
    expect(screen.getByLabelText("Contraseña nueva")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(calls).toEqual([]);
  });

  it("con el enlace ya usado o caducado ofrece pedir otro", async () => {
    stubApi({
      status: 410,
      body: {
        error: {
          code: "gone",
          message: "Este enlace ya no sirve: caducó o ya se usó.",
        },
      },
    });
    render(<NewPasswordForm tokenHash={TOKEN_HASH} />);

    await submitPassword("bajoelagua-nueva");

    expect(
      await screen.findByRole("heading", { name: "Este enlace ya no sirve" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Pedir otro enlace" }),
    ).toHaveAttribute("href", PASSWORD_RECOVERY_PATH);
  });

  it("si el servicio no acepta la contraseña, dice por qué y ofrece pedir otro enlace en vez de dejar el formulario", async () => {
    const rejection =
      "No pudimos usar esa contraseña: es igual a la anterior o demasiado débil. Pide otro enlace y elige una distinta.";
    stubApi({
      status: 410,
      body: { error: { code: "gone", message: rejection } },
    });
    render(<NewPasswordForm tokenHash={TOKEN_HASH} />);

    await submitPassword("bajoelagua-nueva");

    const panel = await screen.findByRole("region", {
      name: "Este enlace ya no sirve",
    });
    expect(panel).toHaveTextContent(rejection);
    expect(
      screen.getByRole("link", { name: "Pedir otro enlace" }),
    ).toHaveAttribute("href", PASSWORD_RECOVERY_PATH);
    expect(
      screen.queryByRole("button", { name: "Guardar contraseña" }),
    ).toBeNull();
  });

  it("muestra el mensaje del servidor ante cualquier otro fallo y deja reintentar", async () => {
    stubApi({
      status: 500,
      body: {
        error: {
          code: "internal_error",
          message: "Ocurrió un error inesperado.",
        },
      },
    });
    render(<NewPasswordForm tokenHash={TOKEN_HASH} />);

    await submitPassword("bajoelagua-nueva");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ocurrió un error inesperado.",
    );
    expect(
      screen.getByRole("button", { name: "Guardar contraseña" }),
    ).toBeEnabled();
  });

  it("anuncia el mínimo de caracteres junto al campo", () => {
    render(<NewPasswordForm tokenHash={TOKEN_HASH} />);

    expect(
      screen.getByLabelText("Contraseña nueva"),
    ).toHaveAccessibleDescription(/8 caracteres/);
  });
});

describe("enlace de recuperación que no sirve", () => {
  it("dice que el enlace caducó o ya se usó y ofrece pedir otro", () => {
    render(<RecoveryLinkUnusable />);

    expect(
      screen.getByRole("region", { name: "Este enlace ya no sirve" }),
    ).toHaveTextContent(/caducó o ya se usó/);
    expect(
      screen.getByRole("link", { name: "Pedir otro enlace" }),
    ).toHaveAttribute("href", PASSWORD_RECOVERY_PATH);
  });
});
