import { crc32, deflateSync } from "node:zlib";

function chunk(type: string, data: Buffer) {
  const nameAndData = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(nameAndData));
  return Buffer.concat([size, nameAndData, checksum]);
}

const sky = [26, 101, 155] as const;
const sparkles = [
  { x: 0.42, y: 0.52, radius: 0.22, color: [255, 255, 255] },
  { x: 0.65, y: 0.33, radius: 0.1, color: [255, 203, 171] },
  { x: 0.7, y: 0.65, radius: 0.075, color: [182, 235, 207] },
];

// Keep the workspace mark inside the maskable icon's central safe area.
export function appIcon(size: number) {
  const stride = size * 3 + 1;
  const pixels = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = y * stride + 1 + x * 3;
      pixels.set(sky, offset);
      for (const { x: cx, y: cy, radius, color } of sparkles) {
        const dx = Math.abs((x + 0.5) / size - cx);
        const dy = Math.abs((y + 0.5) / size - cy);
        if (dx > radius || dy > radius) continue;
        const edge = 1 - ((dx / radius) ** (2 / 3) + (dy / radius) ** (2 / 3));
        const coverage = Math.max(0, Math.min(1, edge * radius * size + 0.5));
        for (let component = 0; component < sky.length; component++) {
          const from = sky[component]!;
          pixels[offset + component] = Math.round(
            from + coverage * (color[component]! - from),
          );
        }
      }
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
