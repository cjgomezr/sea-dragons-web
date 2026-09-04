import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SUPPORTED_BIT_DEPTH = 8;
const CHANNELS_BY_COLOR_TYPE: Readonly<Record<number, number>> = { 2: 3, 6: 4 };

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly pixels: Uint8Array;
}

export function decodePng(buffer: Buffer): DecodedPng {
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("decodePng: el buffer no es un PNG válido");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  let offset = PNG_SIGNATURE.length;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const data = buffer.subarray(dataStart, dataStart + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }

    offset = dataStart + length + 4; // el chunk termina en un CRC de 4 bytes que no verificamos
  }

  if (bitDepth !== SUPPORTED_BIT_DEPTH) {
    throw new Error(
      `decodePng: solo se soporta bitDepth ${SUPPORTED_BIT_DEPTH}, se recibió ${bitDepth}`,
    );
  }
  const channels = CHANNELS_BY_COLOR_TYPE[colorType];
  if (channels === undefined) {
    throw new Error(`decodePng: colorType ${colorType} no soportado`);
  }

  const rawScanlines = inflateSync(Buffer.concat(idatChunks));
  const pixels = unfilterScanlines(rawScanlines, width, height, channels);

  return { width, height, channels, pixels };
}

export function isUniformImage(png: DecodedPng): boolean {
  const { pixels, channels } = png;
  for (let i = channels; i < pixels.length; i += 1) {
    if (pixels[i] !== pixels[i % channels]) {
      return false;
    }
  }
  return true;
}

function unfilterScanlines(
  rawScanlines: Buffer,
  width: number,
  height: number,
  channels: number,
): Uint8Array {
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  let previousRow = new Uint8Array(stride);
  let readOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filterType = rawScanlines[readOffset];
    readOffset += 1;
    const row = new Uint8Array(stride);

    for (let x = 0; x < stride; x += 1) {
      const rawByte = rawScanlines[readOffset + x] ?? 0;
      const left = x >= channels ? row[x - channels]! : 0;
      const up = previousRow[x]!;
      const upLeft = x >= channels ? previousRow[x - channels]! : 0;
      row[x] = (rawByte + predict(filterType, left, up, upLeft)) & 0xff;
    }

    pixels.set(row, y * stride);
    previousRow = row;
    readOffset += stride;
  }

  return pixels;
}

function predict(
  filterType: number | undefined,
  left: number,
  up: number,
  upLeft: number,
): number {
  switch (filterType) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return Math.floor((left + up) / 2);
    case 4:
      return paethPredictor(left, up, upLeft);
    default:
      throw new Error(`decodePng: tipo de filtro ${filterType} no soportado`);
  }
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distanceToLeft = Math.abs(estimate - left);
  const distanceToUp = Math.abs(estimate - up);
  const distanceToUpLeft = Math.abs(estimate - upLeft);

  if (distanceToLeft <= distanceToUp && distanceToLeft <= distanceToUpLeft)
    return left;
  if (distanceToUp <= distanceToUpLeft) return up;
  return upLeft;
}
