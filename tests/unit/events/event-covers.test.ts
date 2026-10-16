import { describe, expect, it } from "vitest";
import {
  EventValidationError,
  EventsForbiddenError,
} from "@/lib/events/event-creation";
import {
  eventCoverPathsOf,
  signEventCover,
  signEventCoverThumbnails,
  stageEventCover,
} from "@/lib/events/event-covers";
import { NEWS_COVER_MAX_BYTES } from "@/lib/news/news-cover-uploads";
import {
  COVER_CALLER_ID,
  COVER_CLUB_ID,
  NEW_COVER_ID,
  OWN_COVER_ID,
  ORGANIZER_COVER_ID,
  SHRUNK_LARGE,
  SHRUNK_THUMBNAIL,
  SIGNED_URL_PREFIX,
  fakeCoverUploadClub,
  fakeEventCovers,
} from "../helpers/event-covers-club";

/**
 * La imagen de un evento (#644, RF-3 y D7 del PRD de E24): se sube reducida a
 * dos WebP, como la portada de noticias, y se sirve firmada en lote.
 */

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP_BYTES = Uint8Array.from(Buffer.from("RIFF\0\0\0\0WEBPVP8 "));
const PDF_BYTES = Uint8Array.from(Buffer.from("%PDF-1.7\n1 0 obj"));

function stage(
  club: ReturnType<typeof fakeCoverUploadClub>,
  bytes: Uint8Array,
): ReturnType<typeof stageEventCover> {
  return stageEventCover(club.gateways, { callerId: COVER_CALLER_ID, bytes });
}

describe("subir la imagen de un evento", () => {
  it.each([
    ["JPEG", JPEG_BYTES],
    ["PNG", PNG_BYTES],
    ["WebP", WEBP_BYTES],
  ])(
    "guarda la miniatura y la grande de un %s y devuelve el id",
    async (_type, bytes) => {
      const club = fakeCoverUploadClub();

      const staged = await stage(club, bytes);

      const paths = eventCoverPathsOf({
        id: NEW_COVER_ID,
        clubId: COVER_CLUB_ID,
      });
      expect(staged).toEqual({ id: NEW_COVER_ID });
      expect(club.files.get(paths.thumbnail)).toBe(SHRUNK_THUMBNAIL);
      expect(club.files.get(paths.large)).toBe(SHRUNK_LARGE);
      expect(club.inserted).toEqual([
        {
          id: NEW_COVER_ID,
          clubId: COVER_CLUB_ID,
          uploadedBy: COVER_CALLER_ID,
        },
      ]);
    },
  );

  it("guarda las dos versiones en WebP bajo la carpeta del club", () => {
    const paths = eventCoverPathsOf({
      id: NEW_COVER_ID,
      clubId: COVER_CLUB_ID,
    });

    expect(paths).toEqual({
      thumbnail: `${COVER_CLUB_ID}/${NEW_COVER_ID}-thumb.webp`,
      large: `${COVER_CLUB_ID}/${NEW_COVER_ID}-large.webp`,
    });
  });

  it.each([
    ["otro tipo de archivo", PDF_BYTES, "event_cover_type_unsupported"],
    ["un archivo vacío", new Uint8Array(0), "event_cover_empty"],
    [
      "un archivo de más del tope",
      new Uint8Array(NEWS_COVER_MAX_BYTES + 1).fill(0x89),
      "event_cover_too_large",
    ],
  ])("rechaza %s sin guardar nada", async (_case, bytes, code) => {
    const club = fakeCoverUploadClub();

    const attempt = stage(club, bytes);

    await expect(attempt).rejects.toThrow(EventValidationError);
    await expect(attempt).rejects.toMatchObject({ code });
    expect(club.files.size).toBe(0);
    expect(club.inserted).toEqual([]);
  });

  it("rechaza una imagen que no se puede decodificar sin guardar nada", async () => {
    const club = fakeCoverUploadClub({ undecodable: true });

    const attempt = stage(club, PNG_BYTES);

    await expect(attempt).rejects.toMatchObject({
      code: "event_cover_type_unsupported",
    });
    expect(club.files.size).toBe(0);
    expect(club.inserted).toEqual([]);
  });

  it("niega la subida a quien no organiza eventos", async () => {
    const club = fakeCoverUploadClub({ callerRole: "Player" });

    const attempt = stage(club, PNG_BYTES);

    await expect(attempt).rejects.toThrow(EventsForbiddenError);
    expect(club.files.size).toBe(0);
  });

  it("borra los ficheros si la fila no se puede guardar", async () => {
    const club = fakeCoverUploadClub({ failInsert: true });

    const attempt = stage(club, PNG_BYTES);

    await expect(attempt).rejects.toThrow(/no se pudo guardar/);
    expect(club.files.size).toBe(0);
  });
});

describe("firmar las imágenes de los eventos", () => {
  const own = { id: OWN_COVER_ID, clubId: COVER_CLUB_ID };
  const organizer = { id: ORGANIZER_COVER_ID, clubId: COVER_CLUB_ID };

  it("firma las miniaturas de muchos eventos en una sola llamada, sin repetir", async () => {
    const covers = fakeEventCovers({
      storedPaths: [
        eventCoverPathsOf(own).thumbnail,
        eventCoverPathsOf(organizer).thumbnail,
      ],
    });

    const signed = await signEventCoverThumbnails(covers.gateway, [
      own,
      organizer,
      own,
    ]);

    expect(covers.signCalls).toEqual([
      [
        eventCoverPathsOf(own).thumbnail,
        eventCoverPathsOf(organizer).thumbnail,
      ],
    ]);
    expect(signed.get(OWN_COVER_ID)).toBe(
      `${SIGNED_URL_PREFIX}${eventCoverPathsOf(own).thumbnail}`,
    );
  });

  it("no llama a Storage si ningún evento tiene imagen", async () => {
    const covers = fakeEventCovers();

    const signed = await signEventCoverThumbnails(covers.gateway, []);

    expect(signed.size).toBe(0);
    expect(covers.signCalls).toEqual([]);
  });

  it("firma la miniatura y la grande de un evento juntas", async () => {
    const paths = eventCoverPathsOf(own);
    const covers = fakeEventCovers({
      storedPaths: [paths.thumbnail, paths.large],
    });

    const signed = await signEventCover(covers.gateway, own);

    expect(signed).toEqual({
      coverThumbUrl: `${SIGNED_URL_PREFIX}${paths.thumbnail}`,
      coverUrl: `${SIGNED_URL_PREFIX}${paths.large}`,
    });
    expect(covers.signCalls).toHaveLength(1);
  });

  it("da null por un fichero que Storage ya no tiene", async () => {
    const covers = fakeEventCovers();

    const signed = await signEventCover(covers.gateway, own);

    expect(signed).toEqual({ coverThumbUrl: null, coverUrl: null });
  });
});
