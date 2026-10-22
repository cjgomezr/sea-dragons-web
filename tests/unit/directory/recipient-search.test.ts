import { describe, expect, it } from "vitest";
import {
  type RecipientCandidate,
  RECIPIENT_SUGGESTION_LIMIT,
  searchRecipients,
} from "@/lib/directory/recipient-search";

/**
 * El buscador de destinatarios del correo (#858, RF-3 y D8 del PRD de E33):
 * ofrece a los socios activos que no están ya en la lista, sin mirar
 * mayúsculas ni acentos, y marca la parte del nombre que coincide.
 */

function candidate(
  fullName: string,
  status: RecipientCandidate["status"] = "active",
): RecipientCandidate {
  return {
    userId: `id-${fullName}`,
    fullName,
    role: "Player",
    status,
  };
}

const MARTA = candidate("Marta Gil");
const MARIA = candidate("María López");
const OMAR = candidate("Omar Haddad");
const NEREA = candidate("Nerea Ruiz");

function suggestedNames(
  result: ReturnType<typeof searchRecipients>,
): readonly string[] {
  return result.kind === "matches"
    ? result.suggestions.map((suggestion) => suggestion.candidate.fullName)
    : [];
}

describe("searchRecipients", () => {
  it("con la búsqueda vacía no ofrece a nadie", () => {
    const result = searchRecipients({
      candidates: [MARTA, NEREA],
      recipientIds: [],
      query: "   ",
    });

    expect(result).toEqual({ kind: "empty" });
  });

  it("encuentra sin mirar mayúsculas ni acentos, también a mitad del nombre", () => {
    const result = searchRecipients({
      candidates: [MARTA, MARIA, OMAR, NEREA],
      recipientIds: [],
      query: "MAR",
    });

    expect(suggestedNames(result)).toEqual([
      "Marta Gil",
      "María López",
      "Omar Haddad",
    ]);
  });

  it("una búsqueda con tilde encuentra el nombre sin ella", () => {
    const result = searchRecipients({
      candidates: [MARTA, MARIA],
      recipientIds: [],
      query: "marí",
    });

    expect(suggestedNames(result)).toEqual(["María López"]);
  });

  it("no ofrece a quien ya está en la lista", () => {
    const result = searchRecipients({
      candidates: [MARTA, MARIA],
      recipientIds: [MARTA.userId],
      query: "mar",
    });

    expect(suggestedNames(result)).toEqual(["María López"]);
  });

  it("no ofrece a los socios que no están activos", () => {
    const result = searchRecipients({
      candidates: [
        candidate("Mario Baja", "inactive"),
        candidate("Marco Invitado", "incomplete"),
        MARTA,
      ],
      recipientIds: [],
      query: "mar",
    });

    expect(suggestedNames(result)).toEqual(["Marta Gil"]);
  });

  it(`enseña como mucho ${RECIPIENT_SUGGESTION_LIMIT}`, () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      candidate(`Marta ${index}`),
    );

    const result = searchRecipients({
      candidates: many,
      recipientIds: [],
      query: "mar",
    });

    expect(suggestedNames(result)).toHaveLength(RECIPIENT_SUGGESTION_LIMIT);
  });

  it("parte el nombre en la coincidencia, con el texto original", () => {
    const result = searchRecipients({
      candidates: [MARIA],
      recipientIds: [],
      query: "ARIA",
    });

    expect(result.kind === "matches" && result.suggestions[0]?.parts).toEqual([
      { text: "M", isMatch: false },
      { text: "aría", isMatch: true },
      { text: " López", isMatch: false },
    ]);
  });

  it("sin coincidencias lo dice", () => {
    const result = searchRecipients({
      candidates: [NEREA],
      recipientIds: [],
      query: "zz",
    });

    expect(result).toEqual({ kind: "noMatch" });
  });

  it("si todos los que coinciden ya están, lo dice aparte", () => {
    const result = searchRecipients({
      candidates: [MARTA, NEREA],
      recipientIds: [MARTA.userId],
      query: "mar",
    });

    expect(result).toEqual({ kind: "allAlreadyAdded" });
  });

  it("un socio no activo que coincide no cuenta como ya añadido", () => {
    const result = searchRecipients({
      candidates: [candidate("Mario Baja", "inactive")],
      recipientIds: [],
      query: "mar",
    });

    expect(result).toEqual({ kind: "noMatch" });
  });
});
