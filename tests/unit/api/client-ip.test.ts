import { describe, expect, it } from "vitest";
import { SHARED_CLIENT_BUCKET, readClientBucket } from "@/lib/api/client-ip";

/**
 * De qué cliente viene una petición, para contarla contra un cubo. No
 * identifica a nadie: lo único que se le pide es que dos peticiones de la
 * misma procedencia caigan juntas, y que quien no trae cabecera no se libre
 * del límite por no traerla.
 */

function headersWith(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("cubo del cliente", () => {
  it("usa la dirección de x-forwarded-for", () => {
    const bucket = readClientBucket(
      headersWith({ "x-forwarded-for": "203.0.113.7" }),
    );

    expect(bucket).toBe("203.0.113.7");
  });

  it("se queda con el primer valor de x-forwarded-for, que es el cliente", () => {
    const bucket = readClientBucket(
      headersWith({
        "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178",
      }),
    );

    expect(bucket).toBe("203.0.113.7");
  });

  it("usa x-real-ip cuando no hay x-forwarded-for", () => {
    const bucket = readClientBucket(
      headersWith({ "x-real-ip": "198.51.100.4" }),
    );

    expect(bucket).toBe("198.51.100.4");
  });

  it("prefiere x-forwarded-for cuando llegan las dos", () => {
    const bucket = readClientBucket(
      headersWith({
        "x-forwarded-for": "203.0.113.7",
        "x-real-ip": "198.51.100.4",
      }),
    );

    expect(bucket).toBe("203.0.113.7");
  });

  it("manda al cubo compartido una petición sin ninguna cabecera de IP", () => {
    expect(readClientBucket(headersWith({}))).toBe(SHARED_CLIENT_BUCKET);
  });

  it("manda al cubo compartido una cabecera vacía o sólo con espacios", () => {
    expect(readClientBucket(headersWith({ "x-forwarded-for": "   " }))).toBe(
      SHARED_CLIENT_BUCKET,
    );
  });
});

describe("cubo del cliente en IPv6", () => {
  // Un cliente doméstico recibe un /64 entero, así que contar por dirección
  // exacta no limitaría nada: basta cambiar el último grupo en cada petición.
  it("agrupa dos direcciones del mismo /64 en el mismo cubo", () => {
    const primera = readClientBucket(
      headersWith({ "x-forwarded-for": "2001:db8:abcd:1234:0:0:0:1" }),
    );
    const segunda = readClientBucket(
      headersWith({ "x-forwarded-for": "2001:db8:abcd:1234:ffff:ffff:ffff:9" }),
    );

    expect(segunda).toBe(primera);
  });

  it("agrupa igual cuando la dirección viene abreviada con ::", () => {
    const larga = readClientBucket(
      headersWith({ "x-forwarded-for": "2001:0db8:abcd:1234:0:0:0:1" }),
    );
    const corta = readClientBucket(
      headersWith({ "x-forwarded-for": "2001:db8:abcd:1234::1" }),
    );

    expect(corta).toBe(larga);
  });

  it("separa dos /64 distintos", () => {
    const uno = readClientBucket(
      headersWith({ "x-forwarded-for": "2001:db8:abcd:1234::1" }),
    );
    const otro = readClientBucket(
      headersWith({ "x-forwarded-for": "2001:db8:abcd:5678::1" }),
    );

    expect(otro).not.toBe(uno);
  });

  it("no confunde mayúsculas con minúsculas", () => {
    const minusculas = readClientBucket(
      headersWith({ "x-forwarded-for": "2001:db8:abcd:1234::1" }),
    );
    const mayusculas = readClientBucket(
      headersWith({ "x-forwarded-for": "2001:DB8:ABCD:1234::1" }),
    );

    expect(mayusculas).toBe(minusculas);
  });

  it("deja tal cual lo que no es una IPv6 reconocible, en vez de fallar", () => {
    const bucket = readClientBucket(
      headersWith({ "x-forwarded-for": "esto::no::es::una::ip" }),
    );

    expect(bucket).toBe("esto::no::es::una::ip");
  });
});
