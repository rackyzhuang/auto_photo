import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const workspace = process.cwd();
const outputDir = path.join(workspace, "image", "generated-jpg");
const scannerPath = path.join(workspace, "src", "services", "rawEmbeddedJpeg.ts");
const source = fs.readFileSync(scannerPath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;

const scanner = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

const samples = [
  {
    brand: "Nikon",
    source: path.join(workspace, "image", "nikon", "DSC_2156.NEF"),
    outputName: "nikon-DSC_2156-embedded.jpg",
    make: "Nikon",
    model: "NIKON Z6_3",
    lens: "NIKKOR Z 24-70mm f/2.8 S",
    iso: 100,
    minWidth: 6000,
    minHeight: 4000
  },
  {
    brand: "Sony",
    source: path.join(workspace, "image", "sony", "20230813-0192.ARW"),
    outputName: "sony-20230813-0192-embedded.jpg",
    make: "Sony",
    model: "ILCE-7CR",
    lens: "FE 20-70mm F4 G",
    iso: 200,
    minWidth: 9000,
    minHeight: 6000
  }
];

const writeUint16 = (bytes, offset, value) => {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
};

const writeUint32 = (bytes, offset, value) => {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
  bytes[offset + 3] = (value >> 24) & 0xff;
};

const asciiBytes = (value) => Buffer.from(`${value}\0`, "ascii");

const setTiffEntry = (bytes, offset, tag, type, count, valueOrOffset) => {
  writeUint16(bytes, offset, tag);
  writeUint16(bytes, offset + 2, type);
  writeUint32(bytes, offset + 4, count);
  writeUint32(bytes, offset + 8, valueOrOffset);
};

const createExifSegment = (sample) => {
  const make = asciiBytes(sample.make);
  const model = asciiBytes(sample.model);
  const lens = asciiBytes(sample.lens);
  const ifd0EntryCount = 4;
  const exifEntryCount = 2;
  const tiffHeaderSize = 8;
  const ifd0Offset = 8;
  const ifd0Size = 2 + ifd0EntryCount * 12 + 4;
  const makeOffset = ifd0Offset + ifd0Size;
  const modelOffset = makeOffset + make.length;
  const exifIfdOffset = modelOffset + model.length;
  const exifIfdSize = 2 + exifEntryCount * 12 + 4;
  const lensOffset = exifIfdOffset + exifIfdSize;
  const tiffLength = lensOffset + lens.length;
  const tiff = new Uint8Array(tiffLength);

  tiff[0] = 0x49;
  tiff[1] = 0x49;
  writeUint16(tiff, 2, 42);
  writeUint32(tiff, 4, ifd0Offset);

  writeUint16(tiff, ifd0Offset, ifd0EntryCount);
  const ifd0Entries = ifd0Offset + 2;
  setTiffEntry(tiff, ifd0Entries, 0x010f, 2, make.length, makeOffset);
  setTiffEntry(tiff, ifd0Entries + 12, 0x0110, 2, model.length, modelOffset);
  setTiffEntry(tiff, ifd0Entries + 24, 0x0112, 3, 1, 1);
  setTiffEntry(tiff, ifd0Entries + 36, 0x8769, 4, 1, exifIfdOffset);
  writeUint32(tiff, ifd0Entries + 48, 0);
  tiff.set(make, makeOffset);
  tiff.set(model, modelOffset);

  writeUint16(tiff, exifIfdOffset, exifEntryCount);
  const exifEntries = exifIfdOffset + 2;
  setTiffEntry(tiff, exifEntries, 0x8827, 3, 1, sample.iso);
  setTiffEntry(tiff, exifEntries + 12, 0xa434, 2, lens.length, lensOffset);
  writeUint32(tiff, exifEntries + 24, 0);
  tiff.set(lens, lensOffset);

  const payload = new Uint8Array(6 + tiff.length);
  payload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0);
  payload.set(tiff, 6);
  const segmentLength = payload.length + 2;
  const segment = new Uint8Array(segmentLength + 2);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment[2] = (segmentLength >> 8) & 0xff;
  segment[3] = segmentLength & 0xff;
  segment.set(payload, 4);
  return segment;
};

const insertExifAfterSoi = (jpegBytes, sample) => {
  const exifSegment = createExifSegment(sample);
  const output = new Uint8Array(jpegBytes.length + exifSegment.length);
  output.set(jpegBytes.subarray(0, 2), 0);
  output.set(exifSegment, 2);
  output.set(jpegBytes.subarray(2), 2 + exifSegment.length);
  return output;
};

fs.mkdirSync(outputDir, { recursive: true });

const manifest = {
  generatedAt: new Date().toISOString(),
  source: "RAW embedded JPEG extraction for local regression only",
  samples: []
};
let failed = false;

for (const sample of samples) {
  const data = fs.readFileSync(sample.source).subarray(0, scanner.RAW_JPEG_SCAN_LIMIT);
  const candidates = scanner.findEmbeddedJpegCandidates(new Uint8Array(data));
  const best = candidates[0];
  const passed = Boolean(best && best.width >= sample.minWidth && best.height >= sample.minHeight);
  failed ||= !passed;

  if (!best) {
    manifest.samples.push({
      name: sample.outputName,
      brand: sample.brand,
      status: "missing_embedded_jpeg",
      sourceRaw: path.relative(workspace, sample.source)
    });
    continue;
  }

  const outputPath = path.join(outputDir, sample.outputName);
  const outputBytes = insertExifAfterSoi(best.bytes, sample);
  fs.writeFileSync(outputPath, outputBytes);
  manifest.samples.push({
    name: sample.outputName,
    brand: sample.brand,
    status: passed ? "passed" : "too_small",
    sourceRaw: path.relative(workspace, sample.source),
    output: path.relative(workspace, outputPath),
    width: best.width,
    height: best.height,
    bytes: outputBytes.length,
    embeddedBytes: best.length,
    candidateCount: candidates.length,
    expectedBrand: sample.brand,
    make: sample.make,
    model: sample.model,
    lens: sample.lens,
    iso: sample.iso,
    requireModel: true,
    requireLens: true,
    requireIso: true,
    expectedSourceFormat: "jpg",
    shouldRender: true,
    shouldAutoTune: true,
    requireAutoEditChange: true
  });
}

const manifestPath = path.join(outputDir, "sample-manifest.json");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      status: failed ? "failed" : "passed",
      outputDir: path.relative(workspace, outputDir),
      samples: manifest.samples.map((sample) => ({
        name: sample.name,
        brand: sample.brand,
        status: sample.status,
        width: sample.width,
        height: sample.height,
        bytes: sample.bytes
      }))
    },
    null,
    2
  )
);

if (failed) process.exitCode = 1;
