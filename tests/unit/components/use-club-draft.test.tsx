import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DraftSaveOutcome,
  SAVED_NOTICE_DURATION_MS,
  useClubDraft,
} from "@/components/club/use-club-draft";
import type { ApiRequestFailure } from "@/lib/api/request-api";

/**
 * El borrador de una sección de la configuración del club (#719, RF-2 del
 * PRD de E26): sabe si difiere de lo guardado, lo guarda una sola vez,
 * conserva lo escrito si el guardado falla y vuelve a lo guardado al
 * descartar.
 */

type Send = (draft: string, saved: string) => Promise<DraftSaveOutcome<string>>;

const NETWORK_FAILURE: ApiRequestFailure = {
  kind: "failed",
  failure: "network",
  reason: null,
};

function acceptAsIs(draft: string): Promise<DraftSaveOutcome<string>> {
  return Promise.resolve({ kind: "saved", value: draft });
}

function renderDraft(
  options: {
    readonly send?: Send;
    readonly onHasDraftChange?: (hasDraft: boolean) => void;
  } = {},
) {
  return renderHook(() =>
    useClubDraft<string>({
      initial: "Harbour",
      isSame: (draft, saved) => draft.trim() === saved.trim(),
      send: options.send ?? acceptAsIs,
      onHasDraftChange: options.onHasDraftChange ?? (() => undefined),
    }),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("el borrador frente a lo guardado", () => {
  it("no hay borrador mientras nada cambia", () => {
    const { result } = renderDraft();

    expect(result.current.hasDraft).toBe(false);
  });

  it("hay borrador cuando lo escrito difiere de lo guardado", () => {
    const { result } = renderDraft();

    act(() => result.current.change(() => "Bay"));

    expect(result.current.hasDraft).toBe(true);
    expect(result.current.draft).toBe("Bay");
  });

  it("deja de haberlo al deshacer el cambio a mano", () => {
    const { result } = renderDraft();
    act(() => result.current.change(() => "Bay"));

    act(() => result.current.change(() => "Harbour "));

    expect(result.current.hasDraft).toBe(false);
  });

  it("avisa a la pantalla cuando aparece y cuando desaparece", () => {
    const onHasDraftChange = vi.fn();
    const { result } = renderDraft({ onHasDraftChange });

    act(() => result.current.change(() => "Bay"));
    act(() => result.current.change(() => "Harbour"));

    expect(onHasDraftChange.mock.calls).toEqual([[false], [true], [false]]);
  });

  it("deja de contar como borrador cuando la sección se desmonta", () => {
    const onHasDraftChange = vi.fn();
    const { result, unmount } = renderDraft({ onHasDraftChange });
    act(() => result.current.change(() => "Bay"));

    unmount();

    expect(onHasDraftChange).toHaveBeenLastCalledWith(false);
  });

  it("toma lo cargado como guardado y como borrador", () => {
    const { result } = renderDraft();

    act(() => result.current.replaceSaved("Bay"));

    expect(result.current.saved).toBe("Bay");
    expect(result.current.draft).toBe("Bay");
    expect(result.current.hasDraft).toBe(false);
  });
});

describe("descartar", () => {
  it("vuelve a lo guardado y quita el borrador", () => {
    const { result } = renderDraft();
    act(() => result.current.change(() => "Bay"));

    act(() => result.current.discard());

    expect(result.current.draft).toBe("Harbour");
    expect(result.current.hasDraft).toBe(false);
  });

  it("quita el error del último guardado", async () => {
    const { result } = renderDraft({
      send: () => Promise.resolve(NETWORK_FAILURE),
    });
    act(() => result.current.change(() => "Bay"));
    await act(() => result.current.save());

    act(() => result.current.discard());

    expect(result.current.status).toEqual({ kind: "idle" });
  });
});

describe("guardar", () => {
  it("manda el borrador junto a lo guardado", async () => {
    const send = vi.fn<Send>(acceptAsIs);
    const { result } = renderDraft({ send });
    act(() => result.current.change(() => "Bay"));

    await act(() => result.current.save());

    expect(send).toHaveBeenCalledWith("Bay", "Harbour");
  });

  it("toma lo que devuelve el servidor como lo guardado", async () => {
    const { result } = renderDraft({
      send: () => Promise.resolve({ kind: "saved", value: "Bay Barracudas" }),
    });
    act(() => result.current.change(() => "Bay"));

    await act(() => result.current.save());

    expect(result.current.saved).toBe("Bay Barracudas");
    expect(result.current.draft).toBe("Bay Barracudas");
    expect(result.current.hasDraft).toBe(false);
  });

  it("está guardando hasta que el servidor contesta", () => {
    const { result } = renderDraft({
      send: () => new Promise(() => undefined),
    });
    act(() => result.current.change(() => "Bay"));

    act(() => void result.current.save());

    expect(result.current.status).toEqual({ kind: "sending" });
    expect(result.current.hasDraft).toBe(true);
  });

  it("no manda dos veces aunque se pida otra vez mientras guarda", () => {
    const send = vi.fn<Send>(() => new Promise(() => undefined));
    const { result } = renderDraft({ send });
    act(() => result.current.change(() => "Bay"));

    act(() => {
      void result.current.save();
      void result.current.save();
    });

    expect(send).toHaveBeenCalledOnce();
  });

  it("conserva el borrador y dice el error si el guardado falla", async () => {
    const { result } = renderDraft({
      send: () => Promise.resolve(NETWORK_FAILURE),
    });
    act(() => result.current.change(() => "Bay"));

    await act(() => result.current.save());

    expect(result.current.status).toEqual(NETWORK_FAILURE);
    expect(result.current.draft).toBe("Bay");
    expect(result.current.hasDraft).toBe(true);
  });

  it("quita el error en cuanto se vuelve a escribir", async () => {
    const { result } = renderDraft({
      send: () => Promise.resolve(NETWORK_FAILURE),
    });
    act(() => result.current.change(() => "Bay"));
    await act(() => result.current.save());

    act(() => result.current.change(() => "Bay B"));

    expect(result.current.status).toEqual({ kind: "idle" });
  });
});

describe("el aviso de guardado", () => {
  it("sale al guardar y se va solo a los 2,5 s", async () => {
    vi.useFakeTimers();
    const { result } = renderDraft();
    act(() => result.current.change(() => "Bay"));

    await act(() => result.current.save());

    expect(result.current.isSavedNoticeShowing).toBe(true);
    act(() => vi.advanceTimersByTime(SAVED_NOTICE_DURATION_MS - 1));
    expect(result.current.isSavedNoticeShowing).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.isSavedNoticeShowing).toBe(false);
  });

  it("no sale si el guardado falla", async () => {
    const { result } = renderDraft({
      send: () => Promise.resolve(NETWORK_FAILURE),
    });
    act(() => result.current.change(() => "Bay"));

    await act(() => result.current.save());

    expect(result.current.isSavedNoticeShowing).toBe(false);
  });

  it("se va en cuanto hay un cambio nuevo", async () => {
    const { result } = renderDraft();
    act(() => result.current.change(() => "Bay"));
    await act(() => result.current.save());

    act(() => result.current.change(() => "Bay B"));

    expect(result.current.isSavedNoticeShowing).toBe(false);
  });
});
