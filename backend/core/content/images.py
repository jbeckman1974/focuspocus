"""Generate a metadata-free preview of supported, bounded PNG rasters."""

from struct import pack, unpack, unpack_from
import zlib


SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_PIXELS = 4_000_000


def chunk(kind, data):
    return pack(">I", len(data)) + kind + data + pack(">I", zlib.crc32(kind + data))


def png_preview(raw):
    if not raw.startswith(SIGNATURE):
        return None
    offset = len(SIGNATURE)
    header = None
    compressed = bytearray()
    chunks = 0
    while offset + 12 <= len(raw):
        size, kind = unpack_from(">I4s", raw, offset)
        end = offset + 12 + size
        chunks += 1
        if end > len(raw) or chunks > 8192:
            return None
        data = raw[offset + 8:end - 4]
        if zlib.crc32(kind + data) != unpack_from(">I", raw, end - 4)[0]:
            return None
        if header is None:
            if kind != b"IHDR" or size != 13:
                return None
            width, height, depth, color, method, flt, interlace = unpack(">IIBBBBB", data)
            channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(color)
            if (not width or not height or width * height > MAX_PIXELS or channels is None
                    or depth != 8 or method or flt or interlace):
                return None
            header = data
            stride = 1 + width * channels
        elif kind == b"IDAT":
            compressed.extend(data)
        elif kind == b"IEND":
            if size or end != len(raw):
                return None
            decoder = zlib.decompressobj()
            try:
                pixels = decoder.decompress(compressed, stride * height + 1)
            except zlib.error:
                return None
            if (not decoder.eof or decoder.unused_data or len(pixels) != stride * height
                    or any(value > 4 for value in pixels[::stride])):
                return None
            return SIGNATURE + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")
        elif not kind[0] & 0x20:
            return None
        offset = end
    return None


def detected_type(raw, declared):
    if png_preview(raw) is not None:
        return "image/png"
    if declared == "text/plain" and b"\0" not in raw:
        try:
            raw.decode("utf-8")
        except UnicodeDecodeError:
            pass
        else:
            return "text/plain"
    return "application/octet-stream"
