import { describe, expect, it } from "vitest";
import { messageCatalogs } from "@/lib/i18n/message-catalogs";
import {
  findMissingKeys,
  findUntranslatedTexts,
  findUntranslatedTextsInDirectory,
} from "../helpers/untranslated-text";

// El guardián de RF-8 (PRD E17): lo nuevo es lo que se cuela sin traducir, así
// que el test tiene que fallar al escribirlo y no en producción.

function scanComponent(source: string): string[] {
  return findUntranslatedTexts({
    file: "src/components/Example.tsx",
    source,
  }).map(({ text }) => text);
}

describe("claves completas", () => {
  it("falla nombrando la clave y el idioma al que le falta", () => {
    const catalogs = {
      en: { "home.title": "Home", "home.lead": "Welcome" },
      es: { "home.title": "Inicio" },
    };

    expect(findMissingKeys(catalogs)).toEqual([
      { key: "home.lead", locale: "es" },
    ]);
  });

  it("encuentra la clave que falta aunque sea el inglés el incompleto", () => {
    const catalogs = {
      en: { "home.title": "Home" },
      es: { "home.title": "Inicio", "home.lead": "Bienvenida" },
    };

    expect(findMissingKeys(catalogs)).toEqual([
      { key: "home.lead", locale: "en" },
    ]);
  });

  it("los catálogos de la aplicación tienen las mismas claves", () => {
    expect(findMissingKeys(messageCatalogs)).toEqual([]);
  });
});

describe("textos sueltos", () => {
  it("falla nombrando el archivo del componente que trae un texto incrustado", () => {
    const source = `export function Banner() {
      return <p>Bienvenido al club</p>;
    }`;

    expect(
      findUntranslatedTexts({ file: "src/components/Banner.tsx", source }),
    ).toEqual([
      { file: "src/components/Banner.tsx", text: "Bienvenido al club" },
    ]);
  });

  it("marca un texto entre llaves como hijo de un elemento", () => {
    const source = `const Save = () => <button>{"Guardar"}</button>;`;

    expect(scanComponent(source)).toEqual(["Guardar"]);
  });

  it("marca las dos ramas de una condición que se pinta", () => {
    const source = `const State = ({ open }: { open: boolean }) => (
      <span>{open ? "Abierto" : "Cerrado"}</span>
    );`;

    expect(scanComponent(source)).toEqual(["Abierto", "Cerrado"]);
  });

  it("marca el texto que se pinta tras un &&", () => {
    const source = `const Badge = ({ open }: Props) => <p>{open && "Abierto"}</p>;`;

    expect(scanComponent(source)).toEqual(["Abierto"]);
  });

  it("marca los dos lados de un ?? o un ||", () => {
    const source = `const Name = ({ name, nick }: Props) => (
      <p>
        {name ?? "Sin nombre"} {nick || "Sin apodo"}
      </p>
    );`;

    expect(scanComponent(source)).toEqual(["Sin nombre", "Sin apodo"]);
  });

  it("marca la etiqueta que recibe un componente propio", () => {
    const source = `const Form = () => <Field label="Nombre" />;`;

    expect(scanComponent(source)).toEqual(["Nombre"]);
  });

  it("marca los atributos que se leen o se escuchan", () => {
    const source = `const Close = () => (
      <button aria-label="Cerrar menú" title={"Cerrar"}>
        <img alt="Logo del club" src="/logo.svg" />
        <input placeholder="Tu correo" />
      </button>
    );`;

    expect(scanComponent(source)).toEqual([
      "Cerrar menú",
      "Cerrar",
      "Logo del club",
      "Tu correo",
    ]);
  });

  it("no marca un texto dentro de un comentario", () => {
    const source = `const Card = () => (
      <div>
        {/* Texto de relleno hasta que llegue el catálogo */}
        {/** Otro comentario, esta vez de documentación */}
      </div>
    );
    // <p>Un texto comentado fuera del JSX</p>`;

    expect(scanComponent(source)).toEqual([]);
  });

  it("no marca un texto que viene del catálogo", () => {
    const source = `const Title = ({ translate }: Props) => (
      <h1 aria-label={translate("home.title")}>{translate("home.title")}</h1>
    );`;

    expect(scanComponent(source)).toEqual([]);
  });

  it("recorre la interfaz y nombra cada archivo con un texto incrustado", () => {
    const findings = findUntranslatedTextsInDirectory("src");

    expect(findings).toEqual([]);
  });
});

describe("lo que no se traduce", () => {
  it("no marca el nombre del club", () => {
    const source = `const Brand = () => (
      <a href="/" aria-label="Victoria Seadragons">
        <strong>Victoria Seadragons</strong> <span>Seadragons</span>
        <small>© 2026 Victoria Seadragons UWR Club</small>
      </a>
    );`;

    expect(scanComponent(source)).toEqual([]);
  });

  it("no marca las clases de CSS ni otros atributos que no se ven", () => {
    const source = `const Box = () => (
      <div className="app-card app-card--wide" id="main-content" role="region">
        <svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5" /></svg>
      </div>
    );`;

    expect(scanComponent(source)).toEqual([]);
  });

  it("no marca una dirección de correo ni un enlace", () => {
    const source = `const Contact = () => (
      <p>
        <a href="mailto:hola@seadragons.club">hola@seadragons.club</a>
        <a href="https://seadragons.club">https://seadragons.club</a>
      </p>
    );`;

    expect(scanComponent(source)).toEqual([]);
  });

  it("no marca una dirección seguida de puntuación", () => {
    const source = `const Contact = () => (
      <p>
        <a href="mailto:hola@seadragons.club">hola@seadragons.club</a>.
        (https://seadragons.club),
      </p>
    );`;

    expect(scanComponent(source)).toEqual([]);
  });

  it("no marca las entidades de HTML", () => {
    const source = `const Spacer = () => <p>&nbsp;&copy;&#8212;</p>;`;

    expect(scanComponent(source)).toEqual([]);
  });

  it("no marca una ruta de la API ni sus siglas", () => {
    const source = `const Health = () => (
      <a href="/api/v1/health">GET /api/v1/health</a>
    );`;

    expect(scanComponent(source)).toEqual([]);
  });

  it("marca las palabras que acompañan a una ruta", () => {
    const source = `const Health = () => <p>Consulta /api/v1/health</p>;`;

    expect(scanComponent(source)).toEqual(["Consulta /api/v1/health"]);
  });

  it("no marca puntuación, símbolos ni números sueltos", () => {
    const source = `const Meta = ({ a, b }: Props) => (
      <p>{a} · {b} - 2026 (3/4) ×</p>
    );`;

    expect(scanComponent(source)).toEqual([]);
  });

  it("no marca los literales que deciden algo sin pintarse", () => {
    const source = `const Tab = ({ variant }: Props) => (
      <div data-state={variant === "primary" ? "active" : "idle"}>
        {variant === "secondary" && <span className="dot" />}
      </div>
    );`;

    expect(scanComponent(source)).toEqual([]);
  });
});
