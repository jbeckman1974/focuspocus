import { crc32, deflateSync } from "node:zlib";

function chunk(type: string, data: Buffer) {
  const nameAndData = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(nameAndData));
  return Buffer.concat([size, nameAndData, checksum]);
}

// Rasterize the same three outline layers used by the workspace wordmark.
// Solid padding keeps all three layers inside the maskable-icon safe area.
export function appIcon(size: number) {
  const stride = size * 3 + 1;
  const pixels = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(((x + 0.5) / size - 0.5) * 24);
      const py = ((y + 0.5) / size) * 24;
      const lines = [6.2 + dx / 2, 11.4 - dx / 2, 14.7 - dx / 2, 18 - dx / 2];
      const distance = Math.min(...lines.map((line) => Math.abs(py - line)));
      const coverage = Math.max(
        0,
        Math.min(1, (Math.min(5.6 - dx, 0.5 - distance) * size) / 24 + 0.5),
      );
      const offset = y * stride + 1 + x * 3;
      pixels[offset] = 36 + Math.round(203 * coverage);
      pixels[offset + 1] = 87 + Math.round(159 * coverage);
      pixels[offset + 2] = 69 + Math.round(162 * coverage);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
