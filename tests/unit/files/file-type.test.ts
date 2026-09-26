import { describe, expect, it } from "vitest";
import { detectFileType } from "@/lib/files/file-type";

/**
 * El tipo de un fichero por sus bytes (#328). Lo usan la foto de perfil, el
 * logo del club y los adjuntos de las noticias: el nombre y la cabecera
 * `Content-Type` los escribe quien sube, los bytes no mienten tan fácil.
 */

function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

function utf16le(text: string): number[] {
  return [...text].flatMap((character) => [character.charCodeAt(0), 0]);
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const WEBP = Uint8Array.from([
  ...ascii("RIFF"),
  0x24,
  0x00,
  0x00,
  0x00,
  ...ascii("WEBPVP8 "),
]);
const PDF = Uint8Array.from(ascii("%PDF-1.7\n%âãÏÓ\n1 0 obj"));
const DOCX = Uint8Array.from([
  ...ZIP_SIGNATURE,
  ...new Array<number>(26).fill(0),
  ...ascii("[Content_Types].xml"),
  ...ascii("word/document.xml"),
]);
const DOC = Uint8Array.from([
  ...OLE_SIGNATURE,
  ...new Array<number>(504).fill(0),
  ...utf16le("Root Entry"),
  ...utf16le("WordDocument"),
]);

describe("detectFileType", () => {
  it.each([
    ["un JPEG", JPEG, "image/jpeg"],
    ["un PNG", PNG, "image/png"],
    ["un WebP", WEBP, "image/webp"],
    ["un PDF", PDF, "application/pdf"],
    [
      "un Word moderno (.docx)",
      DOCX,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    ["un Word antiguo (.doc)", DOC, "application/msword"],
  ])("reconoce %s por sus bytes", (_name, bytes, type) => {
    expect(detectFileType(bytes)).toBe(type);
  });

  it("no reconoce un GIF", () => {
    expect(detectFileType(Uint8Array.from(ascii("GIF89a......")))).toBeNull();
  });

  it("no reconoce un RIFF que no es WebP", () => {
    const wav = Uint8Array.from([
      ...ascii("RIFF"),
      0,
      0,
      0,
      0,
      ...ascii("WAVE"),
    ]);

    expect(detectFileType(wav)).toBeNull();
  });

  it("no reconoce un ZIP que no es un Word", () => {
    const zip = Uint8Array.from([
      ...ZIP_SIGNATURE,
      ...new Array<number>(26).fill(0),
      ...ascii("fotos/partido.jpg"),
    ]);

    expect(detectFileType(zip)).toBeNull();
  });

  it("no reconoce un documento de Office que no es un Word", () => {
    const spreadsheet = Uint8Array.from([
      ...OLE_SIGNATURE,
      ...new Array<number>(504).fill(0),
      ...utf16le("Root Entry"),
      ...utf16le("Workbook"),
    ]);

    expect(detectFileType(spreadsheet)).toBeNull();
  });

  it("no reconoce un texto que sólo se llama PDF", () => {
    expect(
      detectFileType(Uint8Array.from(ascii("hola, soy un pdf"))),
    ).toBeNull();
  });

  it("no reconoce un fichero vacío", () => {
    expect(detectFileType(new Uint8Array(0))).toBeNull();
  });
});
