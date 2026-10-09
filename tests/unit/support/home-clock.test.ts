import { describe, expect, it } from "vitest";
import {
  type ClockPage,
  HOME_NOW,
  fixClockOnHome,
  showsHome,
} from "../../support/home-clock";

/** Un `page` que sólo apunta a qué hora se le fijó el reloj. */
function fakePage(): ClockPage & { readonly fixedTimes: Date[] } {
  const fixedTimes: Date[] = [];
  const page = {
    fixedTimes,
    clock: {
      setFixedTime: async (time: Date) => {
        fixedTimes.push(time);
      },
    },
  };
  // El de verdad trae el resto del reloj; `fixClockOnHome` no lo usa.
  return page as unknown as ClockPage & { readonly fixedTimes: Date[] };
}

describe("showsHome (#561)", () => {
  // Las rutas por las que pasan los estados del inicio de `tests/ui.spec.ts`:
  // los del propio inicio, el panel del acento, avisos, búsqueda y el menú
  // de la cuenta.
  it.each(["/", "/dashboard", "/dashboard?tab=news", "/dashboard#avisos"])(
    "reconoce %s como el inicio",
    (path) => {
      expect(showsHome(path)).toBe(true);
    },
  );

  it.each(["/club", "/directorio", "/entrar", "/dashboard/otra"])(
    "no confunde %s con el inicio",
    (path) => {
      expect(showsHome(path)).toBe(false);
    },
  );
});

describe("fixClockOnHome (#561)", () => {
  it("fija la hora del inicio antes de visitarlo", async () => {
    const page = fakePage();

    await fixClockOnHome(page, "/dashboard");

    expect(page.fixedTimes).toEqual([HOME_NOW]);
  });

  it("deja el reloj de verdad en cualquier otra pantalla", async () => {
    const page = fakePage();

    await fixClockOnHome(page, "/club");

    expect(page.fixedTimes).toEqual([]);
  });

  it("fija una hora de la tarde en Melbourne, lejos de un cambio de saludo", () => {
    const melbourneHour = new Intl.DateTimeFormat("en-AU", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "Australia/Melbourne",
    }).format(HOME_NOW);

    expect(melbourneHour).toBe("18");
  });
});
