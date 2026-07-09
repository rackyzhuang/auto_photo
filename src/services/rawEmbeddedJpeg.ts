export const RAW_JPEG_SCAN_LIMIT = 32 * 1024 * 1024;
export const RAW_EMBEDDED_JPEG_MAX_BYTES = 16 * 1024 * 1024;

export interface EmbeddedJpegCandidate {
  bytes: Uint8Array;
  start: number;
  length: number;
  width: number;
  height: number;
}

export const parseJpegDimensions = (bytes: Uint8Array): { width: number; height: number; precision: number } | undefined => {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;

  let offset = 2;
  while (offset < bytes.length - 9) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) return undefined;

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return undefined;

    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      return {
        precision: bytes[offset + 2],
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6]
      };
    }

    offset += segmentLength;
  }

  return undefined;
};

export const findEmbeddedJpegCandidates = (
  bytes: Uint8Array,
  options: { maxBytes?: number } = {}
): EmbeddedJpegCandidate[] => {
  const maxBytes = options.maxBytes ?? RAW_EMBEDDED_JPEG_MAX_BYTES;
  const candidates: EmbeddedJpegCandidate[] = [];

  for (let start = 0; start < bytes.length - 3; start += 1) {
    if (bytes[start] !== 0xff || bytes[start + 1] !== 0xd8 || bytes[start + 2] !== 0xff) continue;

    for (let end = start + 4; end < bytes.length - 1; end += 1) {
      if (bytes[end] !== 0xff || bytes[end + 1] !== 0xd9) continue;

      const jpegLength = end + 2 - start;
      if (jpegLength > maxBytes) break;

      const jpeg = bytes.subarray(start, end + 2);
      const dimensions = parseJpegDimensions(jpeg);
      if (dimensions && dimensions.precision === 8 && dimensions.width >= 320 && dimensions.height >= 240) {
        candidates.push({
          bytes: jpeg,
          start,
          length: jpegLength,
          width: dimensions.width,
          height: dimensions.height
        });
      }
      break;
    }
  }

  return candidates.sort((a, b) => b.width * b.height - a.width * a.height || b.length - a.length);
};
