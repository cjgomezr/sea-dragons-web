import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EventForm,
  type FormSubmission,
} from "@/components/calendar/EventForm";
import {
  EMPTY_EVENT_FORM,
  type EventForm as EventFormValues,
} from "@/components/calendar/event-form";
import { buildMapsUrl } from "@/lib/events/event-place";
import type {
  PlaceSuggestion,
  PlaceSuggestions,
} from "@/lib/events/place-search";
import { createTranslator } from "@/lib/i18n/translator";

/**
 * El buscador de lugares del diálogo de evento (#652, RF-5 y D1 del PRD de
 * E24) contra un doble del endpoint de #646: primero los lugares del club y
 * después los de Photon, con la espera entre teclas puesta aquí.
 */

const PLACES_PATH = "/api/v1/events/manage/places";
const SEARCH_DELAY_MS = 300;

const MSAC: PlaceSuggestion = {
  source: "club",
  name: "MSAC Dive Pool",
  address: "Aughtie Dr, Albert Park VIC 3206",
  lat: -37.8423,
  lng: 144.9611,
};
const PRINCES_PARK: PlaceSuggestion = {
  source: "club",
  name: "Princes Park, Oval 2",
  address: "Princes Park Dr, Carlton North VIC 3054",
  lat: -37.7836,
  lng: 144.9616,
};
const PRINCES_BRIDGE: PlaceSuggestion = {
  source: "search",
  name: "Princes Bridge",
  address: "Swanston St, Melbourne VIC 3000",
  lat: -37.8191,
  lng: 144.9683,
};
const PRINCESS_THEATRE: PlaceSuggestion = {
  source: "search",
  name: "Princess Theatre",
  address: "163 Spring St, Melbourne VIC 3000",
  lat: -37.8107,
  lng: 144.9725,
};

const TOP_PLACES: PlaceSuggestions = {
  places: [MSAC, PRINCES_PARK],
  searchAvailable: true,
};

type PlacesResponder = (
  query: string | null,
) => PlaceSuggestions | Promise<PlaceSuggestions>;

/** Las búsquedas que se pidieron, por su `q` (null sin él). */
const queries: (string | null)[] = [];

function stubPlaces(respond: PlacesResponder = () => TOP_PLACES): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname !== PLACES_PATH) {
        throw new Error(`Petición inesperada: ${url.pathname}`);
      }
      const query = url.searchParams.get("q");
      queries.push(query);
      const data = await respond(query);
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function renderForm(
  options: {
    readonly locale?: "en" | "es";
    readonly layout?: "create" | "event";
    readonly initialForm?: EventFormValues;
    readonly submit?: (form: EventFormValues) => Promise<FormSubmission>;
  } = {},
): void {
  const {
    locale = "en",
    layout = "create",
    initialForm = EMPTY_EVENT_FORM,
    submit = async () => ({ kind: "finished" }),
  } = options;
  render(
    <EventForm
      translate={createTranslator(locale)}
      clubGroups={[]}
      layout={layout}
      initialForm={initialForm}
      currentCoverUrl={null}
      submit={submit}
      onCancel={() => undefined}
      onSendingChange={() => undefined}
    />,
  );
}

function locationBox(name = "Location"): HTMLElement {
  return screen.getByRole("combobox", { name });
}

function optionNames(): string[] {
  return within(screen.getByRole("listbox"))
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

/** Escribe sin esperar a la espera entre teclas: el reloj lo mueve el test. */
function typeAt(box: HTMLElement, value: string): void {
  fireEvent.change(box, { target: { value } });
}

async function advance(milliseconds: number): Promise<void> {
  await act(() => vi.advanceTimersByTimeAsync(milliseconds));
}

async function openWithText(text: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  const box = locationBox();
  await user.click(box);
  await user.type(box, text);
  await screen.findByRole("option", { name: /Princes Park, Oval 2/ });
  return box;
}

afterEach(() => {
  queries.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("buscador de lugares", () => {
  it("con el campo vacío y el foco lista los lugares del club más usados", async () => {
    stubPlaces();
    renderForm();

    await userEvent.click(locationBox());

    expect(
      await screen.findByRole("option", { name: /MSAC Dive Pool/ }),
    ).toHaveTextContent("Aughtie Dr, Albert Park VIC 3206");
    expect(optionNames()).toHaveLength(2);
    expect(queries).toEqual([null]);
  });

  it("con menos de 3 caracteres no busca y sigue con los del club", async () => {
    stubPlaces();
    renderForm();
    const user = userEvent.setup();

    await user.click(locationBox());
    await user.type(locationBox(), "pr");
    await screen.findByRole("option", { name: /MSAC Dive Pool/ });

    expect(queries).toEqual([null]);
  });

  it("busca 300 ms después de la última tecla, con los del club primero", async () => {
    vi.useFakeTimers();
    stubPlaces((query) =>
      query === null
        ? TOP_PLACES
        : { places: [PRINCES_PARK, PRINCES_BRIDGE], searchAvailable: true },
    );
    renderForm();
    const box = locationBox();
    act(() => box.focus());
    typeAt(box, "pri");

    await advance(SEARCH_DELAY_MS - 1);
    expect(queries).not.toContain("pri");

    await advance(1);
    expect(queries).toContain("pri");
    expect(optionNames()).toEqual([
      expect.stringContaining("Princes Park, Oval 2"),
      expect.stringContaining("Princes Bridge"),
      "Or keep what you typed as free text (it won't open a map).",
    ]);
    expect(
      screen.getByRole("option", { name: /Princes Bridge/ }),
    ).toHaveTextContent("Swanston St, Melbourne VIC 3000");
  });

  it("descarta la respuesta de una búsqueda anterior que llega tarde", async () => {
    vi.useFakeTimers();
    let answerFirst: (suggestions: PlaceSuggestions) => void = () => undefined;
    stubPlaces((query) => {
      if (query === "prin") {
        return new Promise((resolve) => {
          answerFirst = resolve;
        });
      }
      return query === null
        ? TOP_PLACES
        : { places: [PRINCESS_THEATRE], searchAvailable: true };
    });
    renderForm();
    const box = locationBox();
    act(() => box.focus());

    typeAt(box, "prin");
    await advance(SEARCH_DELAY_MS);
    typeAt(box, "princess");
    await advance(SEARCH_DELAY_MS);
    answerFirst({ places: [PRINCES_BRIDGE], searchAvailable: true });
    await advance(0);

    expect(optionNames()).toEqual([
      expect.stringContaining("Princess Theatre"),
      "Or keep what you typed as free text (it won't open a map).",
    ]);
  });

  it("sin búsqueda disponible enseña los del club y lo dice", async () => {
    stubPlaces((query) =>
      query === null
        ? TOP_PLACES
        : { places: [PRINCES_PARK], searchAvailable: false },
    );
    renderForm();

    await openWithText("princes");

    expect(
      await screen.findByText(
        "Place search isn't available right now. Pick one of the club's places or keep what you typed.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("si la petición falla lo dice, deja el texto libre y no reintenta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const query = new URL(input, "http://localhost").searchParams.get("q");
        queries.push(query);
        return query === null
          ? new Response(JSON.stringify({ data: TOP_PLACES }), { status: 200 })
          : new Response("{}", { status: 500 });
      }),
    );
    renderForm();
    const user = userEvent.setup();
    await user.click(locationBox());
    await user.type(locationBox(), "princes");

    expect(
      await screen.findByText(
        "Place search isn't available right now. Pick one of the club's places or keep what you typed.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("option").at(-1)).toHaveTextContent(
      "Or keep what you typed as free text (it won't open a map).",
    );
    expect(queries.filter((query) => query === "princes")).toHaveLength(1);
  });

  it("termina con la opción de dejar el texto libre, también en español", async () => {
    stubPlaces();
    renderForm({ locale: "es" });
    const user = userEvent.setup();

    await user.click(locationBox("Lugar"));
    await user.type(locationBox("Lugar"), "pr");

    expect((await screen.findAllByRole("option")).at(-1)).toHaveTextContent(
      "O deja lo que escribiste como texto libre (no abrirá un mapa).",
    );
  });

  it("deja el texto libre y cierra la lista al elegir esa opción", async () => {
    stubPlaces();
    renderForm();
    const box = await openWithText("pool");

    await userEvent.click(
      screen.getByRole("option", { name: /keep what you typed/ }),
    );

    expect(box).toHaveValue("pool");
    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("el lugar elegido", () => {
  it("sustituye el campo por la tarjeta con el mapa y Dónde exactamente", async () => {
    stubPlaces();
    renderForm();
    await openWithText("princes");

    await userEvent.click(
      screen.getByRole("option", { name: /Princes Park, Oval 2/ }),
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Princes Park, Oval 2")).toBeInTheDocument();
    expect(
      screen.getByText("Princes Park Dr, Carlton North VIC 3054"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Check on map/ })).toHaveAttribute(
      "href",
      buildMapsUrl({ location: PRINCES_PARK.name, place: PRINCES_PARK }),
    );
    expect(
      screen.getByRole("button", { name: "Change the place" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Where exactly · optional" }),
    ).toBeInTheDocument();
  });

  it("con × vuelve el campo con el texto anterior y el foco en él", async () => {
    stubPlaces();
    renderForm();
    await openWithText("princes");
    await userEvent.click(
      screen.getByRole("option", { name: /Princes Park, Oval 2/ }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Change the place" }),
    );

    expect(locationBox()).toHaveValue("princes");
    expect(locationBox()).toHaveFocus();
  });

  it("se guarda con el lugar y Dónde exactamente", async () => {
    stubPlaces();
    const submit = vi.fn(async (): Promise<FormSubmission> => ({
      kind: "finished",
    }));
    renderForm({
      submit,
      initialForm: {
        ...EMPTY_EVENT_FORM,
        title: "Pool Training",
        startsOn: "2026-10-06",
        startTime: "19:00",
        endTime: "20:30",
      },
    });
    await openWithText("princes");
    await userEvent.click(
      screen.getByRole("option", { name: /Princes Park, Oval 2/ }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Where exactly · optional" }),
      "Field 2",
    );

    await userEvent.click(screen.getByRole("button", { name: "Create event" }));

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        place: {
          name: PRINCES_PARK.name,
          address: PRINCES_PARK.address,
          lat: PRINCES_PARK.lat,
          lng: PRINCES_PARK.lng,
        },
        placeDetail: "Field 2",
      }),
    );
  });

  it("al editar un evento con lugar enseña la tarjeta, en español", () => {
    stubPlaces();

    renderForm({
      locale: "es",
      layout: "event",
      initialForm: {
        ...EMPTY_EVENT_FORM,
        location: PRINCES_PARK.name,
        place: {
          name: PRINCES_PARK.name,
          address: PRINCES_PARK.address,
          lat: PRINCES_PARK.lat,
          lng: PRINCES_PARK.lng,
        },
        placeDetail: "Campo 2",
      },
    });

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Princes Park, Oval 2")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Ver en el mapa/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cambiar el lugar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Dónde exactamente · opcional" }),
    ).toHaveValue("Campo 2");
  });
});

describe("el buscador con el teclado", () => {
  it("es un combobox que controla su listbox", async () => {
    stubPlaces();
    renderForm();
    const box = await openWithText("pri");

    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(box).toHaveAttribute(
      "aria-controls",
      screen.getByRole("listbox").id,
    );
  });

  it("se mueve con las flechas y anuncia la opción activa", async () => {
    stubPlaces();
    renderForm();
    const box = await openWithText("pri");

    await userEvent.keyboard("{ArrowDown}{ArrowDown}");

    const active = screen.getByRole("option", { name: /Princes Park/ });
    expect(box).toHaveAttribute("aria-activedescendant", active.id);
    expect(active).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{ArrowUp}");

    expect(box).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: /MSAC Dive Pool/ }).id,
    );
  });

  it("elige con Enter sin mandar el formulario", async () => {
    stubPlaces();
    const submit = vi.fn(async (): Promise<FormSubmission> => ({
      kind: "finished",
    }));
    renderForm({ submit });
    await openWithText("pri");

    await userEvent.keyboard("{ArrowDown}{Enter}");

    expect(screen.getByText("MSAC Dive Pool")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Change the place" }),
    ).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
  });

  it("cierra la lista con Escape y deja lo escrito", async () => {
    stubPlaces();
    renderForm();
    const box = await openWithText("pri");

    await userEvent.keyboard("{Escape}");

    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(box).toHaveValue("pri");
  });
});
