import { describe, expect, it } from "vitest";
import {
  servesCompiledApp,
  webServerCommand,
} from "../../support/web-server-command";

describe("webServerCommand (#255)", () => {
  it("en CI sirve la aplicación ya compilada", () => {
    expect(webServerCommand({ CI: "true" })).toBe("npm run start");
  });

  it("en local sigue levantando next dev", () => {
    expect(webServerCommand({})).toBe("npm run dev");
  });
});

describe("servesCompiledApp (#435)", () => {
  it("es cierto en CI, donde la suite corre contra la aplicación compilada", () => {
    expect(servesCompiledApp({ CI: "true" })).toBe(true);
  });

  it("es falso en local, donde corre contra next dev", () => {
    expect(servesCompiledApp({})).toBe(false);
  });
});
