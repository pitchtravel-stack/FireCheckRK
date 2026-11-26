function jpegWithExif(dt) {
  // TIFF little-endian: IFD0 1 entry ExifIFD → ExifIFD 1 entry DateTimeOriginal
  const t = [];
  const u16 = (v) => t.push(v & 255, (v >> 8) & 255);
  const u32 = (v) => t.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  t.push(0x49, 0x49); u16(42); u32(8);
  u16(1); u16(0x8769); u16(4); u32(1); u32(26); u32(0);      // IFD0 @8 → exif @26
  u16(1); u16(0x9003); u16(2); u32(20); u32(44); u32(0);     // Exif IFD @26 → string @44
  for (const ch of dt) t.push(ch.charCodeAt(0)); t.push(0);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0].concat(t);
  const len = app1.length + 2;
  return [0xFF, 0xD8, 0xFF, 0xE1, len >> 8, len & 255].concat(app1, [0xFF, 0xD9]).map((b) => (b > 127 ? b - 256 : b));
}

module.exports = { jpegWithExif };
