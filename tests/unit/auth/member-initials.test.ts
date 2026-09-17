import { describe, expect, it } from "vitest";
import { memberInitials } from "@/lib/auth/member-initials";

describe("iniciales de un socio", () => {
  it("toma la primera letra del nombre y la del último apellido", () => {
    expect(memberInitials("Liam O'Connor")).toBe("LO");
  });

  it("usa el último apellido cuando hay varios", () => {
    expect(memberInitials("ana maría lópez gil")).toBe("AG");
  });

  it("se queda con una letra cuando sólo hay un nombre", () => {
    expect(memberInitials("Cher")).toBe("C");
  });

  it("no cuenta los espacios de más", () => {
    expect(memberInitials("  Nerea   Ruiz ")).toBe("NR");
  });

  it("respeta las letras acentuadas", () => {
    expect(memberInitials("Íñigo Álvarez")).toBe("ÍÁ");
  });
});
