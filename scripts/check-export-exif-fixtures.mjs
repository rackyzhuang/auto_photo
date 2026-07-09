import fs from "node:fs";
import path from "node:path";
import jpeg from "jpeg-js";
import ts from "typescript";
import exifr from "exifr";

const workspace = process.cwd();
const fixtureDir = path.join(workspace, "image", "generated-jpg");
const manifestPath = path.join(fixtureDir, "sample-manifest.json");

const transpileTsModule = async (relativePath) => {
  const source = fs.readFileSync(path.join(workspace, relativePath), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove
    }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);
};

const { applyEditPipeline } = await transpileTsModule("src/services/renderPipeline.ts");
const { preserveSafeExif } = await transpileTsModule("src/services/jpegMetadata.ts");

const hslChannels = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"];
const createDefaultHsl = () =>
  Object.fromEntries(hslChannels.map((channel) => [channel, { hue: 0, saturation: 0, luminance: 0 }]));

const exportEditParams = {
  schemaVersion: 1,
  exposure: 4,
  temperature: 2,
  tint: 1,
  contrast: 8,
  highlights: -14,
  shadows: 12,
  whites: 4,
  blacks: -8,
  saturation: 1,
  vibrance: 9,
  clarity: 4,
  texture: 2,
  dehaze: 3,
  vignette: 2,
  grain: 0,
  sharpness: 8,
  noiseReduction: 2,
  skinProtection: 84,
  hsl: createDefaultHsl()
};

const readUint16 = (bytes, offset) => (bytes[offset] << 8) | bytes[offset + 1];

const hasExifSegment = (bytes) => {
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = readUint16(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if (marker === 0xe1 && Buffer.from(bytes.subarray(offset + 4, offset + 10)).toString("ascii") === "Exif\0\0") {
      return true;
    }
    offset += 2 + length;
  }
  return false;
};

const createExportImageData = (decoded, maxEdge = 1800) => {
  const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height));
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(decoded.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(decoded.width - 1, Math.floor(x / scale));
      const sourceOffset = (sourceY * decoded.width + sourceX) * 4;
      const targetOffset = (y * width + x) * 4;
      data[targetOffset] = decoded.data[sourceOffset];
      data[targetOffset + 1] = decoded.data[sourceOffset + 1];
      data[targetOffset + 2] = decoded.data[sourceOffset + 2];
      data[targetOffset + 3] = 255;
    }
  }

  return { data, width, height };
};

const encodeJpegDataUrl = (imageData, quality = 92) => {
  const encoded = jpeg.encode(
    {
      data: Buffer.from(imageData.data),
      width: imageData.width,
      height: imageData.height
    },
    quality
  );
  return `data:image/jpeg;base64,${encoded.data.toString("base64")}`;
};

const dataUrlToBytes = (dataUrl) => {
  const [, payload] = dataUrl.split(",", 2);
  return new Uint8Array(Buffer.from(payload, "base64"));
};

const readExif = async (bytes) => {
  const metadata = await exifr.parse(bytes, {
    tiff: true,
    exif: true,
    gps: false,
    interop: false,
    translateValues: true
  });
  return {
    make: metadata?.Make,
    model: metadata?.Model,
    lens: metadata?.LensModel,
    iso: metadata?.ISO,
    orientation: metadata?.Orientation
  };
};

if (!fs.existsSync(manifestPath)) {
  console.log("EXPORT_EXIF_FIXTURES_MISSING run_prepare_first=true");
  process.exitCode = 1;
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const samples = Array.isArray(manifest.samples) ? manifest.samples : [];
  const results = [];
  let failed = samples.length === 0;

  for (const sample of samples) {
    const sourcePath = path.join(workspace, sample.output ?? "");
    const exists = fs.existsSync(sourcePath);
    const result = {
      name: sample.name,
      brand: sample.brand,
      exists,
      originalHasExif: false,
      renderedHasExif: false,
      preserved: false,
      preservedHasExif: false
    };

    if (!exists) {
      failed = true;
      results.push(result);
      continue;
    }

    const originalBytes = fs.readFileSync(sourcePath);
    const decoded = jpeg.decode(originalBytes, {
      maxMemoryUsageInMB: 1536,
      useTArray: true
    });
    const exportImageData = createExportImageData(decoded);
    applyEditPipeline(exportImageData, exportEditParams);
    const renderedDataUrl = encodeJpegDataUrl(exportImageData);
    const renderedBytes = dataUrlToBytes(renderedDataUrl);
    const asset = {
      id: `fixture-${sample.brand}`,
      file: new File([originalBytes], sample.name, { type: "image/jpeg" }),
      fileHash: sample.name,
      name: sample.name,
      size: originalBytes.length,
      type: "image/jpeg",
      sourceFormat: "jpg",
      isEditable: true,
      objectUrl: "",
      previewUrl: "",
      previewKind: "jpg",
      cameraBrand: sample.brand,
      metadata: { orientation: 1 },
      edits: exportEditParams
    };
    const preserved = await preserveSafeExif(asset, renderedDataUrl);
    const preservedBytes = dataUrlToBytes(preserved.dataUrl);
    const preservedExif = await readExif(preservedBytes);

    Object.assign(result, {
      originalHasExif: hasExifSegment(originalBytes),
      renderedHasExif: hasExifSegment(renderedBytes),
      preserved: preserved.preserved,
      preservedHasExif: hasExifSegment(preservedBytes),
      outputWidth: exportImageData.width,
      outputHeight: exportImageData.height,
      renderedBytes: renderedBytes.length,
      preservedBytes: preservedBytes.length,
      make: preservedExif.make,
      model: preservedExif.model,
      lens: preservedExif.lens,
      iso: preservedExif.iso,
      orientation: preservedExif.orientation
    });

    if (
      !result.originalHasExif ||
      result.renderedHasExif ||
      !result.preserved ||
      !result.preservedHasExif ||
      String(result.make ?? "").toLowerCase() !== String(sample.make ?? sample.brand).toLowerCase() ||
      String(result.model ?? "") !== String(sample.model ?? "") ||
      String(result.lens ?? "") !== String(sample.lens ?? "") ||
      Number(result.iso) !== Number(sample.iso) ||
      String(result.orientation ?? "").toLowerCase() !== "horizontal (normal)" ||
      result.outputWidth < 1200 ||
      result.outputHeight < 700 ||
      result.preservedBytes <= result.renderedBytes
    ) {
      failed = true;
    }

    results.push(result);
  }

  console.log(JSON.stringify({ status: failed ? "failed" : "passed", results }, null, 2));
  if (failed) process.exitCode = 1;
}
