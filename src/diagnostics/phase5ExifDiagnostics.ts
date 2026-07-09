import { createDefaultEditParams } from "../services/editParams";
import { preserveSafeExif } from "../services/jpegMetadata";
import type { PhotoAsset } from "../types";

interface ExifDiagnosticStep {
  name: string;
  status: "passed" | "failed";
  durationMs: number;
  detail: string;
}

interface ExifDiagnosticReport {
  startedAt: string;
  finishedAt?: string;
  totalDurationMs?: number;
  steps: ExifDiagnosticStep[];
  summary: {
    status: "running" | "passed" | "failed";
    originalHasExif: boolean;
    renderedHasExifBeforePreserve: boolean;
    preservedHasExif: boolean;
    preservedOrientation?: number;
    noExifSkipped: boolean;
  };
}

declare global {
  interface Window {
    __AUTO_PHOTO_PHASE5_EXIF_DIAGNOSTICS__?: ExifDiagnosticReport;
  }
}

const JPEG_DATA_URL_PREFIX = "data:image/jpeg;base64,";
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

const now = () => performance.now();

const readUint16 = (bytes: Uint8Array, offset: number) => (bytes[offset] << 8) | bytes[offset + 1];

const readTiffUint16 = (bytes: Uint8Array, offset: number, littleEndian: boolean) => {
  if (littleEndian) return bytes[offset] | (bytes[offset + 1] << 8);
  return (bytes[offset] << 8) | bytes[offset + 1];
};

const readTiffUint32 = (bytes: Uint8Array, offset: number, littleEndian: boolean) => {
  if (littleEndian) {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
};

const bytesToDataUrl = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `${JPEG_DATA_URL_PREFIX}${btoa(binary)}`;
};

const dataUrlToBytes = (dataUrl: string) => {
  if (!dataUrl.startsWith(JPEG_DATA_URL_PREFIX)) throw new Error("Expected JPG data URL");
  const binary = atob(dataUrl.slice(JPEG_DATA_URL_PREFIX.length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const walkJpegMetadataSegments = (
  bytes: Uint8Array,
  visitor: (segmentStart: number, segmentEnd: number, marker: number) => void
) => {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = readUint16(bytes, offset + 2);
    if (length < 2) break;
    const segmentEnd = offset + 2 + length;
    if (segmentEnd > bytes.length) break;
    visitor(offset, segmentEnd, marker);
    offset = segmentEnd;
  }
};

const isExifApp1 = (bytes: Uint8Array, segmentStart: number, segmentEnd: number) => {
  if (bytes[segmentStart + 1] !== 0xe1) return false;
  const contentStart = segmentStart + 4;
  if (contentStart + EXIF_HEADER.length > segmentEnd) return false;
  return EXIF_HEADER.every((value, index) => bytes[contentStart + index] === value);
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

const hasExifSegment = (bytes: Uint8Array) => Boolean(findExifSegment(bytes));

const readExifOrientation = (bytes: Uint8Array) => {
  const segment = findExifSegment(bytes);
  if (!segment) return undefined;

  const tiffStart = 4 + EXIF_HEADER.length;
  const endianMarker = String.fromCharCode(segment[tiffStart], segment[tiffStart + 1]);
  const littleEndian = endianMarker === "II";
  if (!littleEndian && endianMarker !== "MM") return undefined;
  if (readTiffUint16(segment, tiffStart + 2, littleEndian) !== 42) return undefined;

  const ifd0Offset = readTiffUint32(segment, tiffStart + 4, littleEndian);
  const ifd0Start = tiffStart + ifd0Offset;
  const entryCount = readTiffUint16(segment, ifd0Start, littleEndian);
  const entriesStart = ifd0Start + 2;

  for (let index = 0; index < entryCount; index += 1) {
    const entryStart = entriesStart + index * 12;
    const tag = readTiffUint16(segment, entryStart, littleEndian);
    const type = readTiffUint16(segment, entryStart + 2, littleEndian);
    const count = readTiffUint32(segment, entryStart + 4, littleEndian);
    if (tag === 0x0112 && type === 3 && count === 1) {
      return readTiffUint16(segment, entryStart + 8, littleEndian);
    }
  }
  return undefined;
};

const createExifOrientationSegment = (orientation: number) =>
  new Uint8Array([
    0xff,
    0xe1,
    0x00,
    0x22,
    ...EXIF_HEADER,
    0x49,
    0x49,
    0x2a,
    0x00,
    0x08,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x12,
    0x01,
    0x03,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    orientation,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00
  ]);

const createJpegBytes = (exifSegment?: Uint8Array) => {
  const soi = [0xff, 0xd8];
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const scan = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9];
  return new Uint8Array([...soi, ...app0, ...(exifSegment ? Array.from(exifSegment) : []), ...scan]);
};

const createSyntheticAsset = (file: File, orientation?: number): PhotoAsset => ({
  id: "phase5-exif-original",
  file,
  fileHash: "phase5-exif-hash",
  name: file.name,
  size: file.size,
  type: file.type,
  sourceFormat: "jpg",
  isEditable: true,
  objectUrl: "",
  previewUrl: "",
  previewKind: "jpg",
  cameraBrand: "Sony",
  metadata: {
    make: "Sony",
    model: "Phase 5 Synthetic",
    orientation
  },
  edits: createDefaultEditParams()
});

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string));

const renderReport = (report: ExifDiagnosticReport) => {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");
  const rows = report.steps
    .map(
      (step) =>
        `<tr><td>${step.status}</td><td>${escapeHtml(step.name)}</td><td>${Math.round(step.durationMs)} ms</td><td>${escapeHtml(step.detail)}</td></tr>`
    )
    .join("");

  root.innerHTML = `
    <main style="max-width:960px;margin:0 auto;padding:24px;font-family:Segoe UI,Arial,sans-serif;color:#17202a">
      <h1 style="margin:0 0 8px;font-size:26px">Phase 5 Exif Diagnostics</h1>
      <p>Status: <strong>${report.summary.status}</strong></p>
      <section style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:18px 0">
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Original EXIF<br><strong>${String(report.summary.originalHasExif)}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Rendered EXIF<br><strong>${String(report.summary.renderedHasExifBeforePreserve)}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Preserved EXIF<br><strong>${String(report.summary.preservedHasExif)}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Orientation<br><strong>${report.summary.preservedOrientation ?? "n/a"}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">No EXIF Skip<br><strong>${String(report.summary.noExifSkipped)}</strong></div>
      </section>
      <table style="width:100%;border-collapse:collapse;background:white;border:1px solid #dfe4ea"><tbody>${rows}</tbody></table>
    </main>
  `;
  root.querySelectorAll("td").forEach((cell) => {
    const element = cell as HTMLElement;
    element.style.borderTop = "1px solid #edf0f3";
    element.style.padding = "8px 10px";
    element.style.fontSize = "13px";
  });
};

const runStep = async (report: ExifDiagnosticReport, name: string, run: () => Promise<string>) => {
  const started = now();
  try {
    const detail = await run();
    report.steps.push({ name, status: "passed", durationMs: now() - started, detail });
  } catch (error) {
    report.steps.push({
      name,
      status: "failed",
      durationMs: now() - started,
      detail: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    renderReport(report);
  }
};

export const runPhase5ExifDiagnostics = async () => {
  const report: ExifDiagnosticReport = {
    startedAt: new Date().toISOString(),
    steps: [],
    summary: {
      status: "running",
      originalHasExif: false,
      renderedHasExifBeforePreserve: false,
      preservedHasExif: false,
      noExifSkipped: false
    }
  };
  window.__AUTO_PHOTO_PHASE5_EXIF_DIAGNOSTICS__ = report;
  const started = now();
  renderReport(report);

  try {
    await runStep(report, "preserve APP1 EXIF and normalize Orientation", async () => {
      const originalBytes = createJpegBytes(createExifOrientationSegment(6));
      const renderedBytes = createJpegBytes();
      report.summary.originalHasExif = hasExifSegment(originalBytes);
      report.summary.renderedHasExifBeforePreserve = hasExifSegment(renderedBytes);

      const file = new File([originalBytes], "phase5-exif-orientation-6.jpg", { type: "image/jpeg" });
      const asset = createSyntheticAsset(file, 6);
      const result = await preserveSafeExif(asset, bytesToDataUrl(renderedBytes));
      const preservedBytes = dataUrlToBytes(result.dataUrl);
      report.summary.preservedHasExif = hasExifSegment(preservedBytes);
      report.summary.preservedOrientation = readExifOrientation(preservedBytes);

      if (!report.summary.originalHasExif) throw new Error("Original synthetic JPG did not contain EXIF APP1");
      if (report.summary.renderedHasExifBeforePreserve) throw new Error("Rendered synthetic JPG unexpectedly contained EXIF");
      if (!result.preserved) throw new Error(result.skippedReason ?? "EXIF was not preserved");
      if (!report.summary.preservedHasExif) throw new Error("Preserved output did not contain EXIF APP1");
      if (report.summary.preservedOrientation !== 1) {
        throw new Error(`Expected normalized Orientation=1, got ${report.summary.preservedOrientation ?? "n/a"}`);
      }

      return "APP1 copied into rendered JPG and Orientation normalized from 6 to 1";
    });

    await runStep(report, "skip source without EXIF", async () => {
      const originalBytes = createJpegBytes();
      const renderedBytes = createJpegBytes();
      const file = new File([originalBytes], "phase5-exif-no-source-exif.jpg", { type: "image/jpeg" });
      const result = await preserveSafeExif(createSyntheticAsset(file, 1), bytesToDataUrl(renderedBytes));
      report.summary.noExifSkipped = !result.preserved && !hasExifSegment(dataUrlToBytes(result.dataUrl));
      if (!report.summary.noExifSkipped) throw new Error("Source without EXIF should skip preservation without injecting EXIF");
      return result.skippedReason ?? "Skipped without source EXIF";
    });

    report.summary.status = "passed";
  } catch {
    report.summary.status = "failed";
  } finally {
    report.finishedAt = new Date().toISOString();
    report.totalDurationMs = now() - started;
    renderReport(report);
  }

  return report;
};
