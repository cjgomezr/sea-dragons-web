import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type BundleScan,
  FORBIDDEN_KEY_PREFIX,
  SERVICE_ROLE_JWT_LABEL,
  clientBundleScans,
  forbiddenNeedles,
  scanForLeaks,
} from "../../scripts/lib/client-bundle";
import { readEnvironmentManifest } from "../../scripts/lib/entornos-manifest";

const JAVASCRIPT = [".js"] as const;
const createdDirectories: string[] = [];

function scanOf(files: Record<string, string>): BundleScan {
  const dir = mkdtempSync(path.join(tmpdir(), "bundle-"));
  createdDirectories.push(dir);

  for (const [relativePath, content] of Object.entries(files)) {
    const file = path.join(dir, relativePath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
  }
  return {
    dir,
    extensions: JAVASCRIPT,
    needles: forbiddenNeedles(readEnvironmentManifest()),
    mustHaveFiles: true,
  };
}

/** JWT de juguete con el rol que se le pida. Los tres segmentos van en
 * base64url, como los de verdad, pero la firma es texto: nada aquí sirve para
 * autenticarse contra nada. */
function jwtWithRole(role: string): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode({ role })}.firmadementira`;
}

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("bundle de cliente", () => {
  it("no encuentra nada en un bundle que sólo usa variables públicas", () => {
    const scan = scanOf({
      "chunks/page.js": 'const u="https://un-proyecto.supabase.co";',
    });

    expect(scanForLeaks(scan).leaks).toEqual([]);
  });

  it("cuenta los archivos que revisó, para que un directorio que encoge se note", () => {
    const scan = scanOf({
      "chunks/a.js": "// vacío",
      "chunks/b.js": "// vacío",
      "chunks/estilos.css": "// no es JavaScript",
    });

    expect(scanForLeaks(scan).filesRead).toBe(2);
  });

  it("nombra el archivo y la variable cuando un secreto llega al bundle", () => {
    const scan = scanOf({
      "chunks/page.js": "const k=process.env.SUPABASE_SERVICE_ROLE_KEY;",
    });

    expect(scanForLeaks(scan).leaks).toEqual([
      { file: "chunks/page.js", needle: "SUPABASE_SERVICE_ROLE_KEY" },
    ]);
  });

  it("caza una clave secreta pegada como literal, aunque no se nombre la variable", () => {
    const scan = scanOf({
      "chunks/app.js": `const k="${FORBIDDEN_KEY_PREFIX}unaclavecualquiera";`,
    });

    expect(scanForLeaks(scan).leaks).toEqual([
      { file: "chunks/app.js", needle: FORBIDDEN_KEY_PREFIX },
    ]);
  });

  it("busca en subdirectorios, no sólo en la raíz", () => {
    const scan = scanOf({
      "chunks/app/nested/deep.js": "SUPABASE_ACCESS_TOKEN",
    });

    expect(scanForLeaks(scan).leaks.map((leak) => leak.file)).toEqual([
      "chunks/app/nested/deep.js",
    ]);
  });

  it("ignora lo que no lleva la extensión pedida", () => {
    const scan = {
      ...scanOf({
        "chunks/page.css": "SUPABASE_SERVICE_ROLE_KEY",
        "chunks/page.js": "// limpio",
      }),
      extensions: JAVASCRIPT,
    };

    expect(scanForLeaks(scan).leaks).toEqual([]);
  });

  it("falla ruidosamente cuando el directorio no existe, en vez de darlo por limpio", () => {
    expect(() =>
      scanForLeaks({
        dir: path.join(tmpdir(), "un-bundle-que-no-existe"),
        extensions: JAVASCRIPT,
        needles: ["lo-que-sea"],
        mustHaveFiles: true,
      }),
    ).toThrowError(/un-bundle-que-no-existe/);
  });

  // Un build interrumpido, un `.next` a medio limpiar o un cambio de Next en
  // dónde deja los chunks dan un directorio vacío, y eso no es un bundle
  // limpio: es un bundle que nadie miró.
  it("falla cuando el directorio existe pero no tiene un solo archivo que revisar", () => {
    const scan = scanOf({ "chunks/estilos.css": "// no es JavaScript" });

    expect(() => scanForLeaks(scan)).toThrowError(/no tiene ningún archivo/);
  });

  it("busca las cuatro variables secretas de hoy y el prefijo de clave", () => {
    expect(forbiddenNeedles(readEnvironmentManifest())).toEqual([
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_ACCESS_TOKEN",
      "SUPABASE_PRODUCTION_DB_URL",
      "RESEND_API_KEY",
      FORBIDDEN_KEY_PREFIX,
    ]);
  });

  it("caza la credencial del proveedor de correo si llega al bundle", () => {
    const scan = scanOf({
      "chunks/page.js": "const k=process.env.RESEND_API_KEY;",
    });

    expect(scanForLeaks(scan).leaks).toEqual([
      { file: "chunks/page.js", needle: "RESEND_API_KEY" },
    ]);
  });
});

// El formato clásico de Supabase es un JWT sin ningún nombre reconocible
// dentro, así que las agujas de texto no lo ven. Y por la forma no se
// distingue de la llave anónima, que sí puede estar en el bundle: lo que las
// separa es el rol del payload.
describe("clave de servicio en formato JWT", () => {
  it("caza un JWT cuyo payload dice service_role", () => {
    const scan = scanOf({
      "chunks/page.js": `const k="${jwtWithRole("service_role")}";`,
    });

    expect(scanForLeaks(scan).leaks).toEqual([
      { file: "chunks/page.js", needle: SERVICE_ROLE_JWT_LABEL },
    ]);
  });

  it("deja pasar la llave anónima, que viaja al navegador con todo derecho", () => {
    const scan = scanOf({
      "chunks/page.js": `const k="${jwtWithRole("anon")}";`,
    });

    expect(scanForLeaks(scan).leaks).toEqual([]);
  });

  it("no se atraganta con una cadena que empieza por eyJ y no es un JWT", () => {
    const scan = scanOf({
      "chunks/page.js": 'const s="eyJnoesto.tampoco.nada";',
    });

    expect(scanForLeaks(scan).leaks).toEqual([]);
  });
});

describe("qué se revisa del build", () => {
  // El HTML prerenderizado y los payloads RSC viven bajo `.next/server`, pero
  // el navegador se los lleva igual. Revisar sólo `.next/static` dejaría fuera
  // una clave incrustada en el HTML.
  it("revisa el JavaScript de cliente y también el HTML prerenderizado", () => {
    const scans = clientBundleScans(readEnvironmentManifest());

    expect(scans.map((scan) => scan.dir)).toEqual([
      ".next/static",
      ".next/server/app",
    ]);
    expect(scans[0]?.extensions).toEqual([".js"]);
    expect(scans[1]?.extensions).toEqual([".html", ".rsc"]);
  });

  it("usa la misma lista de cadenas prohibidas en los dos sitios", () => {
    const needles = forbiddenNeedles(readEnvironmentManifest());

    for (const scan of clientBundleScans(readEnvironmentManifest())) {
      expect(scan.needles).toEqual(needles);
    }
  });

  // Un `.next/static` sin JavaScript es un build roto. Un `.next/server/app`
  // sin HTML es lo que deja una aplicación enteramente dinámica, y poner el
  // check en rojo por eso sería un rojo que nadie sabe arreglar.
  it("exige archivos en el bundle de cliente, pero no en el HTML prerenderizado", () => {
    const [client, prerendered] = clientBundleScans(readEnvironmentManifest());

    expect(client?.mustHaveFiles).toBe(true);
    expect(prerendered?.mustHaveFiles).toBe(false);
  });

  it("no falla cuando no queda nada prerenderizado que revisar", () => {
    const scan = {
      ...scanOf({ "algo.txt": "ni html ni rsc" }),
      extensions: [".html", ".rsc"],
      mustHaveFiles: false,
    };

    expect(scanForLeaks(scan)).toEqual({ filesRead: 0, leaks: [] });
  });
});
