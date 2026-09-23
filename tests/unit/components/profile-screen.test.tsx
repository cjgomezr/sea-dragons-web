import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileScreen } from "@/components/account/ProfileScreen";
import { ACCOUNT_PROFILE_API_PATH } from "@/lib/auth/routes";
import { listCountryOptions } from "@/lib/geo/countries";
import type { Locale } from "@/lib/i18n/locale";
import type { OwnProfile } from "@/lib/members/own-profile";

/**
 * La pantalla de perfil (#241): Mi cuenta convertida en perfil. Enseña lo
 * que ya enseñaba (rol, solicitud de rol y grupos) y suma el formulario de la
 * ficha editable. Lo que se prueba es que sólo da un cambio por hecho cuando
 * el servidor lo confirmó.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const PROFILE: OwnProfile = {
  fullName: "Nerea Ruiz",
  country: "AU",
  position: "Defender",
  experienceLevel: "Intermediate",
  gender: "female",
};

const EMPTY_PROFILE: OwnProfile = {
  fullName: "Nerea Ruiz",
  country: "AU",
  position: null,
  experienceLevel: null,
  gender: null,
};

type ApiCall = { readonly url: string; readonly body: unknown };

const calls: ApiCall[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(respond: (body: unknown) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body: unknown = JSON.parse(String(init.body));
      calls.push({ url, body });
      return respond(body);
    }),
  );
}

function echoSavedProfile(): void {
  stubFetch((body) => jsonResponse(200, { data: body }));
}

function renderScreen(
  options: { readonly locale?: Locale; readonly profile?: OwnProfile } = {},
): void {
  const locale = options.locale ?? "en";
  render(
    <ProfileScreen
      locale={locale}
      account={{ fullName: "Nerea Ruiz", role: "Player", latestRequest: null }}
      profile={options.profile ?? PROFILE}
      photoUrl={null}
      groups={[{ id: "g1", name: "Senior Squad" }]}
      countries={listCountryOptions(locale)}
    />,
  );
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "Save changes" });
}

beforeEach(() => {
  calls.length = 0;
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pantalla de perfil", () => {
  it("carga la ficha con sus valores actuales", () => {
    renderScreen();

    expect(screen.getByLabelText("Full name")).toHaveValue("Nerea Ruiz");
    expect(screen.getByLabelText("Country")).toHaveValue("AU");
    expect(screen.getByLabelText("Position")).toHaveValue("Defender");
    expect(screen.getByLabelText("Experience level")).toHaveValue(
      "Intermediate",
    );
    expect(screen.getByLabelText("Gender")).toHaveValue("female");
  });

  it("carga los campos vacíos como sin indicar", () => {
    renderScreen({ profile: EMPTY_PROFILE });

    const position = screen.getByLabelText("Position");
    expect(position).toHaveValue("");
    expect(
      within(position).getByRole("option", { name: "Not set" }),
    ).toBeInTheDocument();
  });

  it("no ofrece cambiar la fecha de nacimiento, que sólo corrige un Admin", () => {
    renderScreen();

    expect(screen.queryByLabelText(/date of birth/i)).not.toBeInTheDocument();
  });

  it("sigue mostrando el rol, la solicitud de rol y los grupos propios", () => {
    renderScreen();

    expect(screen.getByText("Role: Player")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Request a role" }),
    ).toBeInTheDocument();
    const groups = screen.getByRole("region", { name: "My groups" });
    expect(within(groups).getByText("Senior Squad")).toBeInTheDocument();
  });

  it("guarda los cinco campos, lo confirma y refresca la cabecera", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();

    await user.clear(screen.getByLabelText("Full name"));
    await user.type(screen.getByLabelText("Full name"), "Nerea Ruiz Soto");
    await user.selectOptions(screen.getByLabelText("Position"), "Forward");
    await user.selectOptions(screen.getByLabelText("Gender"), "undisclosed");
    await user.click(saveButton());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Changes saved.",
    );
    expect(calls).toEqual([
      {
        url: ACCOUNT_PROFILE_API_PATH,
        body: {
          fullName: "Nerea Ruiz Soto",
          country: "AU",
          position: "Forward",
          experienceLevel: "Intermediate",
          gender: "undisclosed",
        },
      },
    ]);
    expect(refresh).toHaveBeenCalled();
  });

  it("manda null por un campo vaciado a propósito", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();

    await user.selectOptions(screen.getByLabelText("Position"), "");
    await user.click(saveButton());

    await screen.findByRole("status");
    expect(calls[0]?.body).toMatchObject({ position: null });
  });

  it("no envía un nombre vacío y dice por qué", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();

    await user.clear(screen.getByLabelText("Full name"));
    await user.type(screen.getByLabelText("Full name"), "   ");
    await user.click(saveButton());

    expect(screen.getByLabelText("Full name")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByText("Write your name.")).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("no envía un nombre de más de 120 caracteres y dice el límite", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();

    await user.clear(screen.getByLabelText("Full name"));
    await user.click(screen.getByLabelText("Full name"));
    await user.paste("a".repeat(121));
    await user.click(saveButton());

    expect(
      screen.getByText("Your name can be at most 120 characters."),
    ).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("desactiva el botón mientras guarda y un doble clic manda una sola petición", async () => {
    let answer: (response: Response) => void = () => undefined;
    stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const user = userEvent.setup();
    renderScreen();

    await user.dblClick(saveButton());

    const sending = screen.getByRole("button", { name: "Saving…" });
    expect(sending).toBeDisabled();
    expect(calls).toHaveLength(1);
    answer(jsonResponse(200, { data: PROFILE }));
    await screen.findByRole("status");
  });

  it("dice que falló la red, no da el cambio por hecho y deja reintentar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const user = userEvent.setup();
    renderScreen();

    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't save your changes. Check your connection and try again.",
    );
    expect(screen.queryByText("Changes saved.")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();

    echoSavedProfile();
    await user.click(saveButton());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Changes saved.",
    );
  });

  it("traduce el motivo de un 400 del servidor", async () => {
    stubFetch(() =>
      jsonResponse(400, {
        error: {
          code: "validation_error",
          message: "x",
          reason: "position_unknown",
        },
      }),
    );
    const user = userEvent.setup();
    renderScreen();

    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a position from the list.",
    );
  });

  it("borra el aviso de guardado en cuanto se edita otra vez", async () => {
    echoSavedProfile();
    const user = userEvent.setup();
    renderScreen();

    await user.click(saveButton());
    await screen.findByRole("status");
    await user.type(screen.getByLabelText("Full name"), "x");

    expect(screen.queryByText("Changes saved.")).not.toBeInTheDocument();
  });

  it("en español, los textos, las opciones y los errores salen en español", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const user = userEvent.setup();
    renderScreen({ locale: "es" });

    expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument();
    expect(screen.getByLabelText("País")).toHaveDisplayValue("Australia");
    const position = screen.getByLabelText("Posición");
    expect(
      within(position).getByRole("option", { name: "Defensa" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Género")).getByRole("option", {
        name: "Prefiero no decirlo",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos guardar tus cambios. Revisa tu conexión y vuelve a intentarlo.",
    );
  });
});
