import fs from "node:fs";
import path from "node:path";
import jpeg from "jpeg-js";
import ts from "typescript";
import exifr from "exifr";

const workspace = process.cwd();
const fixtureDir = path.join(workspace, "image", "generated-jpg");
const manifestPath = path.join(fixtureDir, "sample-manifest.json");
const renderPipelinePath = path.join(workspace, "src", "services", "renderPipeline.ts");
const renderPipelineSource = fs.readFileSync(renderPipelinePath, "utf8");
const renderPipelineTranspiled = ts.transpileModule(renderPipelineSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const { applyEditPipeline } = await import(
  `data:text/javascript;base64,${Buffer.from(renderPipelineTranspiled).toString("base64")}`
);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const hslChannels = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"];
const createDefaultHsl = () =>
  Object.fromEntries(hslChannels.map((channel) => [channel, { hue: 0, saturation: 0, luminance: 0 }]));

const defaultParams = {
  schemaVersion: 1,
  exposure: 0,
  temperature: 0,
  tint: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  saturation: 0,
  vibrance: 0,
  clarity: 0,
  texture: 0,
  dehaze: 0,
  vignette: 0,
  grain: 0,
  sharpness: 0,
  noiseReduction: 0,
  skinProtection: 70,
  hsl: createDefaultHsl()
};

const ranges = {
  exposure: [-50, 50],
  temperature: [-50, 50],
  tint: [-50, 50],
  contrast: [-50, 50],
  highlights: [-60, 40],
  shadows: [-40, 60],
  whites: [-40, 40],
  blacks: [-40, 40],
  saturation: [-50, 50],
  vibrance: [-50, 50],
  clarity: [-50, 50],
  texture: [-50, 50],
  dehaze: [-50, 50],
  vignette: [-50, 50],
  grain: [0, 50],
  sharpness: [0, 40],
  noiseReduction: [0, 40],
  skinProtection: [0, 100]
};

const analyzeDecodedJpeg = (decoded) => {
  const { data, width, height } = decoded;
  const targetSamples = 120_000;
  const stride = Math.max(1, Math.floor((width * height) / targetSamples));
  let r = 0;
  let g = 0;
  let b = 0;
  let luma = 0;
  let skinLike = 0;
  let count = 0;

  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += stride) {
    const offset = pixelIndex * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const y = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    r += red;
    g += green;
    b += blue;
    luma += y;
    count += 1;

    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    if (red > 72 && green > 42 && blue > 28 && red > green && green >= blue && max - min > 16) {
      skinLike += 1;
    }
  }

  const averageR = r / count;
  const averageG = g / count;
  const averageB = b / count;
  return {
    averageLuma: luma / count,
    redBalance: averageR / 255,
    greenBalance: averageG / 255,
    blueBalance: averageB / 255,
    warmBias: (averageR - averageB) / 255,
    skinLikeRatio: skinLike / count
  };
};

const createAutoEdit = (brand, iso, analysis) => {
  const brandWarmOffset = brand === "Sony" ? -4 : brand === "Nikon" ? 2 : 0;
  const brandTintOffset = brand === "Sony" ? 4 : 0;
  const lumaTarget = 128;
  const lumaDelta = lumaTarget - analysis.averageLuma;
  const exposure = clamp(lumaDelta / 3.4, -28, 28);
  const temperature = clamp(-analysis.warmBias * 42 + brandWarmOffset, -28, 28);
  const tint = clamp((analysis.greenBalance - (analysis.redBalance + analysis.blueBalance) / 2) * -45 + brandTintOffset, -20, 20);
  const skinProtection = analysis.skinLikeRatio > 0.035 ? 84 : 62;

  return {
    ...defaultParams,
    hsl: createDefaultHsl(),
    exposure,
    temperature,
    tint,
    contrast: clamp(10 - Math.abs(exposure) * 0.18, 4, 13),
    highlights: clamp(-12 - Math.max(0, analysis.averageLuma - 140) * 0.28, -32, -8),
    shadows: clamp(10 + Math.max(0, 118 - analysis.averageLuma) * 0.2, 6, 26),
    whites: clamp(5 + exposure * 0.08, -4, 10),
    blacks: clamp(-8 - Math.max(0, analysis.averageLuma - 128) * 0.08, -16, -4),
    saturation: analysis.skinLikeRatio > 0.04 ? -1 : 2,
    vibrance: analysis.skinLikeRatio > 0.04 ? 8 : 12,
    sharpness: iso && iso >= 3200 ? 4 : 10,
    noiseReduction: iso ? clamp((iso - 800) / 180, 0, 22) : 4,
    clarity: analysis.skinLikeRatio > 0.04 ? 2 : 8,
    texture: analysis.skinLikeRatio > 0.04 ? -2 : 6,
    dehaze: analysis.averageLuma < 92 ? 2 : 6,
    vignette: analysis.skinLikeRatio > 0.04 ? 4 : 0,
    grain: 0,
    skinProtection
  };
};

const hasMeaningfulEditChange = (edits) =>
  Object.entries(defaultParams).some(([key, value]) => Math.abs(Number(edits[key]) - Number(value)) >= 0.1);

const paramsInRange = (edits) =>
  Object.entries(ranges).every(([key, [min, max]]) => {
    const value = edits[key];
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
  });

const readUint16 = (bytes, offset) => (bytes[offset] << 8) | bytes[offset + 1];

const hasExifSegment = (bytes) => {
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = readUint16(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if (marker === 0xe1 && bytes.subarray(offset + 4, offset + 10).toString("ascii") === "Exif\0\0") return true;
    offset += 2 + length;
  }
  return false;
};

const readFixtureExif = async (bytes) => {
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

const createPreviewImageData = (decoded, maxEdge = 900) => {
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

const summarizePixelDifference = (before, after) => {
  let changed = 0;
  let totalDelta = 0;
  const count = before.length / 4;
  for (let index = 0; index < before.length; index += 4) {
    const delta =
      Math.abs(Number(before[index]) - Number(after[index])) +
      Math.abs(Number(before[index + 1]) - Number(after[index + 1])) +
      Math.abs(Number(before[index + 2]) - Number(after[index + 2]));
    if (delta > 2) changed += 1;
    totalDelta += delta / 3;
  }
  return {
    changedRatio: changed / count,
    averageDelta: totalDelta / count
  };
};

if (!fs.existsSync(manifestPath)) {
  console.log("JPG_FIXTURES_MISSING run_prepare_first=true");
  process.exitCode = 1;
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const samples = Array.isArray(manifest.samples) ? manifest.samples : [];
  const results = [];
  let failed = samples.length === 0;

  for (const sample of samples) {
    const outputPath = path.join(workspace, sample.output ?? "");
    const exists = fs.existsSync(outputPath);
    let result = {
      name: sample.name,
      brand: sample.brand,
      exists,
      width: 0,
      height: 0,
      averageLuma: 0,
      skinLikeRatio: 0,
      autoEditChanged: false,
      paramsInRange: false
    };

    if (!exists) {
      failed = true;
      results.push(result);
      continue;
    }

    const fileBytes = fs.readFileSync(outputPath);
    const exif = await readFixtureExif(fileBytes);
    const decoded = jpeg.decode(fileBytes, {
      maxMemoryUsageInMB: 1536,
      useTArray: true
    });
    const analysis = analyzeDecodedJpeg(decoded);
    const edits = createAutoEdit(sample.brand, sample.iso, analysis);
    const previewBefore = createPreviewImageData(decoded);
    const beforePixels = new Uint8ClampedArray(previewBefore.data);
    applyEditPipeline(previewBefore, edits);
    const pixelDiff = summarizePixelDifference(beforePixels, previewBefore.data);
    const encodedPreview = jpeg.encode(
      {
        data: Buffer.from(previewBefore.data),
        width: previewBefore.width,
        height: previewBefore.height
      },
      88
    );
    result = {
      ...result,
      width: decoded.width,
      height: decoded.height,
      averageLuma: Number(analysis.averageLuma.toFixed(2)),
      skinLikeRatio: Number(analysis.skinLikeRatio.toFixed(4)),
      autoEditChanged: hasMeaningfulEditChange(edits),
      paramsInRange: paramsInRange(edits),
      hasExif: hasExifSegment(fileBytes),
      make: exif.make,
      model: exif.model,
      lens: exif.lens,
      iso: exif.iso,
      orientation: exif.orientation,
      previewWidth: previewBefore.width,
      previewHeight: previewBefore.height,
      previewBytes: encodedPreview.data.length,
      changedRatio: Number(pixelDiff.changedRatio.toFixed(4)),
      averageDelta: Number(pixelDiff.averageDelta.toFixed(2)),
      exposure: Number(edits.exposure.toFixed(2)),
      temperature: Number(edits.temperature.toFixed(2)),
      tint: Number(edits.tint.toFixed(2)),
      skinProtection: Number(edits.skinProtection.toFixed(2))
    };

    const expectedWidth = Number(sample.width);
    const expectedHeight = Number(sample.height);
    if (
      decoded.width !== expectedWidth ||
      decoded.height !== expectedHeight ||
      !result.hasExif ||
      String(result.make ?? "").toLowerCase() !== String(sample.make ?? sample.brand).toLowerCase() ||
      String(result.model ?? "") !== String(sample.model ?? "") ||
      String(result.lens ?? "") !== String(sample.lens ?? "") ||
      Number(result.iso) !== Number(sample.iso) ||
      !result.autoEditChanged ||
      !result.paramsInRange ||
      result.previewBytes < 1024 ||
      result.changedRatio < 0.01 ||
      result.averageDelta <= 0
    ) {
      failed = true;
    }
    results.push(result);
  }

  console.log(JSON.stringify({ status: failed ? "failed" : "passed", results }, null, 2));
  if (failed) process.exitCode = 1;
}
