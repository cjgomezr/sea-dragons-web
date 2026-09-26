import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileScreen } from "@/components/account/ProfileScreen";
import { ACCOUNT_PROFILE_PHOTO_API_PATH } from "@/lib/auth/routes";
import { listCountryOptions } from "@/lib/geo/countries";
import type { Locale } from "@/lib/i18n/locale";
import { PROFILE_PHOTO_MAX_BYTES } from "@/lib/members/profile-photo";

/**
 * La foto del perfil propio (#245): el círculo de la cabecera de
 * docs/mockups/mobile-profile-light.png, que enseña la foto o las iniciales,
 * y los controles para subirla, cambiarla o quitarla. Lo que se prueba es que
 * avisa antes de subir lo que no vale, y que sólo cambia la foto cuando el
 * servidor lo confirmó.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const OLD_URL = "https://storage.test/member-photos/vieja.webp?token=a";
const NEW_URL = "https://storage.test/member-photos/nueva.png?token=b";
const OWN_USER_ID = "cccccccc-0000-4000-8000-00000000000c";
const LARGE_URL = "https://storage.test/member-photos/grande.webp?token=c";

type ApiCall = {
  readonly url: string;
  readonly method: string | undefined;
  readonly body: unknown;
};

const calls: ApiCall[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(
  ...responses: readonly (() => Response | Promise<Response>)[]
): void {
  let next = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body });
      const respond = responses[Math.min(next, responses.length - 1)];
      next += 1;
      if (respond === undefined) {
        throw new Error("El test no preparó ninguna respuesta.");
      }
      return respond();
    }),
  );
}

const photoSaved = (): Response =>
  jsonResponse(200, { data: { photoUrl: NEW_URL } });
const networkDown = (): Response => {
  throw new TypeError("Failed to fetch");
};

function renderScreen(
  options: { readonly locale?: Locale; readonly photoUrl?: string | null } = {},
): void {
  const locale = options.locale ?? "en";
  render(
    <ProfileScreen
      locale={locale}
      userId={OWN_USER_ID}
      account={{ fullName: "Nerea Ruiz", role: "Player", latestRequest: null }}
      profile={{
        fullName: "Nerea Ruiz",
        country: "AU",
        positionId: null,
        experienceLevel: null,
        gender: null,
        auf: { status: "none" },
      }}
      positionOptions={[]}
      photoUrl={options.photoUrl === undefined ? OLD_URL : options.photoUrl}
      groups={[]}
      countries={listCountryOptions(locale)}
    />,
  );
}

function photoFile(
  options: { readonly type?: string; readonly size?: number } = {},
): File {
  return new File([new Uint8Array(options.size ?? 64)], "foto.png", {
    type: options.type ?? "image/png",
  });
}

async function choosePhoto(
  file: File,
  label = "Choose a photo",
): Promise<void> {
  await userEvent.upload(screen.getByLabelText(label), file, {
    applyAccept: false,
  });
}

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("perfil con foto", () => {
  it("enseña la foto en el círculo de la cabecera", () => {
    renderScreen();

    expect(
      screen.getByRole("img", { name: "Your profile photo" }),
    ).toHaveAttribute("src", OLD_URL);
    expect(
      screen.getByRole("button", { name: "Change photo" }),
    ).toBeInTheDocument();
  });

  it("abre la foto propia en grande al pulsarla (#355)", async () => {
    stubFetch(() => jsonResponse(200, { data: { photoUrl: LARGE_URL } }));
    renderScreen();

    await userEvent.click(
      screen.getByRole("button", { name: "Open the photo of Nerea Ruiz" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Nerea Ruiz" });
    expect(
      await within(dialog).findByRole("img", { name: "Photo of Nerea Ruiz" }),
    ).toHaveAttribute("src", LARGE_URL);
    expect(calls.map((call) => call.url)).toEqual([
      `/api/v1/directory/${OWN_USER_ID}/photo`,
    ]);
  });

  it("sin foto enseña las iniciales, como hasta ahora", () => {
    renderScreen({ photoUrl: null });

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("NR")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add photo" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Remove photo" }),
    ).not.toBeInTheDocument();
  });

  it("dice qué formatos valen y hasta cuánto pesa, antes de elegir", () => {
    renderScreen();

    expect(
      screen.getByText("JPEG, PNG or WebP, up to 2 MB."),
    ).toBeInTheDocument();
  });

  it("sube la foto elegida y la enseña cuando el servidor la guardó", async () => {
    stubFetch(photoSaved);
    renderScreen({ photoUrl: null });
    const file = photoFile();

    await choosePhoto(file);

    expect(calls).toEqual([
      { url: ACCOUNT_PROFILE_PHOTO_API_PATH, method: "PUT", body: file },
    ]);
    expect(
      await screen.findByRole("img", { name: "Your profile photo" }),
    ).toHaveAttribute("src", NEW_URL);
    expect(screen.getByRole("status")).toHaveTextContent("Photo updated.");
  });

  it("avisa de una foto de más de 2 MB sin subirla", async () => {
    stubFetch(photoSaved);
    renderScreen();

    await choosePhoto(photoFile({ size: PROFILE_PHOTO_MAX_BYTES + 1 }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This photo is larger than 2 MB. Choose a smaller one.",
    );
    expect(calls).toEqual([]);
  });

  it("avisa de un formato que no vale, diciendo cuáles valen, sin subirlo", async () => {
    stubFetch(photoSaved);
    renderScreen();

    await choosePhoto(photoFile({ type: "image/gif" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Only JPEG, PNG or WebP photos are accepted.",
    );
    expect(calls).toEqual([]);
  });

  it("si la subida falla a mitad conserva la foto anterior y ofrece reintentar", async () => {
    stubFetch(networkDown, photoSaved);
    renderScreen();
    const file = photoFile();

    await choosePhoto(file);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Your photo hasn't changed/,
    );
    expect(
      screen.getByRole("img", { name: "Your profile photo" }),
    ).toHaveAttribute("src", OLD_URL);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(calls.map((call) => call.body)).toEqual([file, file]);
    expect(
      await screen.findByRole("img", { name: "Your profile photo" }),
    ).toHaveAttribute("src", NEW_URL);
  });

  it("explica el rechazo del servidor por su motivo", async () => {
    stubFetch(() =>
      jsonResponse(400, {
        error: {
          code: "validation_error",
          message: "Sólo valen fotos JPEG, PNG o WebP.",
          reason: "photo_type_unsupported",
        },
      }),
    );
    renderScreen();

    await choosePhoto(photoFile());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only JPEG, PNG or WebP photos are accepted.",
    );
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });

  it("al quitar la foto vuelven las iniciales", async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));

    expect(calls).toEqual([
      {
        url: ACCOUNT_PROFILE_PHOTO_API_PATH,
        method: "DELETE",
        body: undefined,
      },
    ]);
    expect(await screen.findByText("NR")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Photo removed.");
  });

  it("si quitarla falla, la foto sigue ahí", async () => {
    stubFetch(networkDown);
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Your photo hasn't changed/,
    );
    expect(
      screen.getByRole("img", { name: "Your profile photo" }),
    ).toHaveAttribute("src", OLD_URL);
  });

  it("en español, los controles y el aviso salen en español", async () => {
    stubFetch(photoSaved);
    renderScreen({ locale: "es" });

    await choosePhoto(
      photoFile({ size: PROFILE_PHOTO_MAX_BYTES + 1 }),
      "Elegir una foto",
    );

    expect(
      screen.getByRole("img", { name: "Tu foto de perfil" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cambiar foto" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Esta foto pesa más de 2 MB. Elige una más pequeña.",
    );
  });
});
