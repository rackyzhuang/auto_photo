import type { PhotoAsset } from "../types";

export interface ExifPreservationResult {
  dataUrl: string;
  preserved: boolean;
  skippedReason?: string;
}

const JPEG_DATA_URL_PREFIX = "data:image/jpeg;base64,";
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

const readUint16 = (bytes: Uint8Array, offset: number) => (bytes[offset] << 8) | bytes[offset + 1];

type TiffEndian = "little" | "big";

const normalizeOrientation = (orientation?: number | string) => {
  if (typeof orientation === "number") return orientation;
  if (typeof orientation === "string") {
    const match = orientation.match(/\d+/);
    if (match) return Number(match[0]);
    const lower = orientation.toLowerCase();
    if (lower.includes("90") && lower.includes("cw")) return 6;
    if (lower.includes("90") && lower.includes("ccw")) return 8;
    if (lower.includes("180")) return 3;
  }
  return 1;
};

const isJpeg = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8;

const dataUrlToBytes = (dataUrl: string) => {
  if (!dataUrl.startsWith(JPEG_DATA_URL_PREFIX)) throw new Error("导出结果不是 JPG data URL");
  const binary = atob(dataUrl.slice(JPEG_DATA_URL_PREFIX.length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const bytesToDataUrl = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `${JPEG_DATA_URL_PREFIX}${btoa(binary)}`;
};

const isExifApp1 = (bytes: Uint8Array, segmentStart: number, segmentEnd: number) => {
  if (bytes[segmentStart + 1] !== 0xe1) return false;
  const contentStart = segmentStart + 4;
  if (contentStart + EXIF_HEADER.length > segmentEnd) return false;
  return EXIF_HEADER.every((value, index) => bytes[contentStart + index] === value);
};

const walkJpegMetadataSegments = (
  bytes: Uint8Array,
  visitor: (segmentStart: number, segmentEnd: number, marker: number) => void
) => {
  if (!isJpeg(bytes)) return;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }

    const length = readUint16(bytes, offset + 2);
    if (length < 2) break;
    const segmentEnd = offset + 2 + length;
    if (segmentEnd > bytes.length) break;
    visitor(offset, segmentEnd, marker);
    offset = segmentEnd;
  }
};

const findExifSegment = (bytes: Uint8Array) => {
  let exifSegment: Uint8Array | undefined;
  walkJpegMetadataSegments(bytes, (segmentStart, segmentEnd) => {
    if (!exifSegment && isExifApp1(bytes, segmentStart, segmentEnd)) {
      exifSegment = bytes.slice(segmentStart, segmentEnd);
    }
  });
  return exifSegment;
};

const readTiffUint16 = (bytes: Uint8Array, offset: number, endian: TiffEndian) => {
  if (endian === "little") return bytes[offset] | (bytes[offset + 1] << 8);
  return (bytes[offset] << 8) | bytes[offset + 1];
};

const readTiffUint32 = (bytes: Uint8Array, offset: number, endian: TiffEndian) => {
  if (endian === "little") {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
};

const writeTiffUint16 = (bytes: Uint8Array, offset: number, value: number, endian: TiffEndian) => {
  if (endian === "little") {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >> 8) & 0xff;
    return;
  }
  bytes[offset] = (value >> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
};

const normalizeExifOrientationSegment = (segment: Uint8Array) => {
  const normalized = segment.slice();
  const tiffStart = 4 + EXIF_HEADER.length;
  if (tiffStart + 8 > normalized.length) return undefined;

  const endianMarker = String.fromCharCode(normalized[tiffStart], normalized[tiffStart + 1]);
  const endian: TiffEndian | undefined = endianMarker === "II" ? "little" : endianMarker === "MM" ? "big" : undefined;
  if (!endian) return undefined;
  if (readTiffUint16(normalized, tiffStart + 2, endian) !== 42) return undefined;

  const ifd0Offset = readTiffUint32(normalized, tiffStart + 4, endian);
  const ifd0Start = tiffStart + ifd0Offset;
  if (ifd0Start + 2 > normalized.length) return undefined;

  const entryCount = readTiffUint16(normalized, ifd0Start, endian);
  const entriesStart = ifd0Start + 2;
  if (entriesStart + entryCount * 12 > normalized.length) return undefined;

  for (let index = 0; index < entryCount; index += 1) {
    const entryStart = entriesStart + index * 12;
    const tag = readTiffUint16(normalized, entryStart, endian);
    const type = readTiffUint16(normalized, entryStart + 2, endian);
    const count = readTiffUint32(normalized, entryStart + 4, endian);
    if (tag === 0x0112 && type === 3 && count === 1) {
      writeTiffUint16(normalized, entryStart + 8, 1, endian);
      return normalized;
    }
  }

  return undefined;
};

const removeExifSegments = (bytes: Uint8Array) => {
  const keep: Uint8Array[] = [bytes.slice(0, 2)];
  let lastOffset = 2;

  walkJpegMetadataSegments(bytes, (segmentStart, segmentEnd) => {
    if (lastOffset < segmentStart) keep.push(bytes.slice(lastOffset, segmentStart));
    if (!isExifApp1(bytes, segmentStart, segmentEnd)) keep.push(bytes.slice(segmentStart, segmentEnd));
    lastOffset = segmentEnd;
  });

  keep.push(bytes.slice(lastOffset));
  const totalLength = keep.reduce((total, chunk) => total + chunk.length, 0);
  const stripped = new Uint8Array(totalLength);
  let outputOffset = 0;
  for (const chunk of keep) {
    stripped.set(chunk, outputOffset);
    outputOffset += chunk.length;
  }
  return stripped;
};

const findExifInsertOffset = (bytes: Uint8Array) => {
  let insertOffset = 2;
  walkJpegMetadataSegments(bytes, (segmentStart, segmentEnd, marker) => {
    if (segmentStart !== insertOffset) return;
    if (marker === 0xe0 || marker === 0xee) insertOffset = segmentEnd;
  });
  return insertOffset;
};

const insertSegment = (bytes: Uint8Array, segment: Uint8Array, offset: number) => {
  const output = new Uint8Array(bytes.length + segment.length);
  output.set(bytes.slice(0, offset), 0);
  output.set(segment, offset);
  output.set(bytes.slice(offset), offset + segment.length);
  return output;
};

export const preserveSafeExif = async (asset: PhotoAsset, renderedDataUrl: string): Promise<ExifPreservationResult> => {
  const originalBytes = new Uint8Array(await asset.file.arrayBuffer());
  const exifSegment = findExifSegment(originalBytes);
  if (!exifSegment) {
    return { dataUrl: renderedDataUrl, preserved: false, skippedReason: "原图没有可复制的 EXIF APP1 段" };
  }

  const renderedBytes = dataUrlToBytes(renderedDataUrl);
  if (!isJpeg(renderedBytes)) {
    return { dataUrl: renderedDataUrl, preserved: false, skippedReason: "导出结果不是有效 JPG" };
  }

  const strippedBytes = removeExifSegments(renderedBytes);
  const orientation = normalizeOrientation(asset.metadata.orientation);
  const normalizedExifSegment = normalizeExifOrientationSegment(exifSegment) ?? (orientation === 1 ? exifSegment : undefined);
  if (!normalizedExifSegment) {
    return {
      dataUrl: renderedDataUrl,
      preserved: false,
      skippedReason: "原图 EXIF Orientation 无法安全归一，已跳过 EXIF 复制"
    };
  }

  const outputBytes = insertSegment(strippedBytes, normalizedExifSegment, findExifInsertOffset(strippedBytes));
  return { dataUrl: bytesToDataUrl(outputBytes), preserved: true };
};
