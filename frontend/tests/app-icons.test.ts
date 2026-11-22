import assert from "node:assert/strict";
import test from "node:test";
import { crc32, inflateSync } from "node:zlib";
import { appIcon } from "../src/pwa/icons.ts";

test("install icons have reproducible PNG chunks and their advertised dimensions", () => {
  for (const size of [192, 512]) {
    const png = appIcon(size);
    assert.equal(png.readUInt32BE(), 0x89504e47);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    let offset = 8;
    const chunks: string[] = [];
    while (offset < png.length) {
      const length = png.readUInt32BE(offset);
      const data = png.subarray(offset + 4, offset + 8 + length);
      const type = data.toString("ascii", 0, 4);
      chunks.push(type);
      assert.equal(crc32(data), png.readUInt32BE(offset + length + 8));
      if (type === "IDAT")
        assert.equal(
          inflateSync(data.subarray(4)).length,
          (1 + size * 3) * size,
        );
      offset += length + 12;
    }
    assert.deepEqual(chunks, ["IHDR", "IDAT", "IEND"]);
    assert.deepEqual(png, appIcon(size));
  }
});
