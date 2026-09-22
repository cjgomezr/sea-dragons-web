import { describe, expect, it } from "vitest";
import { webServerCommand } from "../../support/web-server-command";

describe("webServerCommand (#255)", () => {
  it("en CI sirve la aplicación ya compilada", () => {
    expect(webServerCommand({ CI: "true" })).toBe("npm run start");
  });

  it("en local sigue levantando next dev", () => {
    expect(webServerCommand({})).toBe("npm run dev");
  });
});
