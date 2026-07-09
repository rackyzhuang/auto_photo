import fs from "node:fs";
import path from "node:path";
import jpeg from "jpeg-js";
import ts from "typescript";

const workspace = process.cwd();
const manifestPath = path.join(workspace, "image", "generated-jpg", "sample-manifest.json");

const loadTsModule = async (relativePath) => {
  const sourcePath = path.join(workspace, relativePath);
  const source = fs.readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);
};

const { builtInPresets, normalizeEditParams } = await loadTsModule(path.join("src", "services", "editParams.ts"));
const { applyEditPipeline } = await loadTsModule(path.join("src", "services", "renderPipeline.ts"));

const createPreviewImageData = (decoded, maxEdge = 720) => {
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

const summarizePixels = (before, after) => {
  let changed = 0;
  let totalDelta = 0;
  let luma = 0;
  let minLuma = 255;
  let maxLuma = 0;
  let alphaMismatch = 0;
  const count = after.length / 4;

  for (let index = 0; index < after.length; index += 4) {
    const red = Number(after[index]);
    const green = Number(after[index + 1]);
    const blue = Number(after[index + 2]);
    const pixelLuma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const delta =
      Math.abs(Number(before[index]) - red) +
      Math.abs(Number(before[index + 1]) - green) +
      Math.abs(Number(before[index + 2]) - blue);

    if (delta > 2) changed += 1;
    totalDelta += delta / 3;
    luma += pixelLuma;
    minLuma = Math.min(minLuma, pixelLuma);
    maxLuma = Math.max(maxLuma, pixelLuma);
    if (after[index + 3] !== 255) alphaMismatch += 1;
  }

  return {
    changedRatio: changed / count,
    averageDelta: totalDelta / count,
    averageLuma: luma / count,
    lumaSpan: maxLuma - minLuma,
    alphaMismatch
  };
};

const findings = [];
const fail = (message) => findings.push(message);

if (!fs.existsSync(manifestPath)) {
  fail("generated JPG manifest missing; run npm run prepare:jpg-fixtures first");
}

const manifest = findings.length === 0 ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { samples: [] };
const samples = Array.isArray(manifest.samples) ? manifest.samples : [];
if (samples.length < 2) fail(`expected at least 2 generated JPG samples, got ${samples.length}`);
if (!Array.isArray(builtInPresets) || builtInPresets.length === 0) fail("builtInPresets is empty");

const samplePreviews = [];
for (const sample of samples) {
  const outputPath = path.join(workspace, sample.output ?? "");
  if (!fs.existsSync(outputPath)) {
    fail(`${sample.name}: generated JPG missing`);
    continue;
  }
  const decoded = jpeg.decode(fs.readFileSync(outputPath), {
    maxMemoryUsageInMB: 1536,
    useTArray: true
  });
  const preview = createPreviewImageData(decoded);
  if (preview.width < 100 || preview.height < 100) fail(`${sample.name}: preview too small`);
  samplePreviews.push({ name: sample.name, brand: sample.brand, preview });
}

const renderSummaries = [];
for (const preset of builtInPresets) {
  const edits = normalizeEditParams(preset.params);
  for (const sample of samplePreviews) {
    const imageData = {
      width: sample.preview.width,
      height: sample.preview.height,
      data: new Uint8ClampedArray(sample.preview.data)
    };
    const before = new Uint8ClampedArray(imageData.data);
    applyEditPipeline(imageData, edits);
    const stats = summarizePixels(before, imageData.data);
    const encoded = jpeg.encode(
      {
        data: Buffer.from(imageData.data),
        width: imageData.width,
        height: imageData.height
      },
      86
    );

    const label = `${preset.id} on ${sample.brand}`;
    if (stats.changedRatio < 0.005 && stats.averageDelta < 0.2) fail(`${label}: rendered change too small`);
    if (stats.averageLuma <= 4 || stats.averageLuma >= 251) fail(`${label}: average luma out of bounds`);
    if (stats.lumaSpan < 18) fail(`${label}: luma span too narrow`);
    if (stats.alphaMismatch > 0) fail(`${label}: alpha channel changed`);
    if (encoded.data.length < 4096) fail(`${label}: encoded JPG too small`);

    renderSummaries.push({
      presetId: preset.id,
      sampleBrand: sample.brand,
      changedRatio: stats.changedRatio,
      averageDelta: stats.averageDelta,
      averageLuma: stats.averageLuma,
      lumaSpan: stats.lumaSpan,
      encodedBytes: encoded.data.length
    });
  }
}

const minValue = (key) => Math.min(...renderSummaries.map((item) => item[key]));
const maxValue = (key) => Math.max(...renderSummaries.map((item) => item[key]));

const summary = {
  status: findings.length > 0 ? "failed" : "passed",
  sampleCount: samplePreviews.length,
  presetCount: builtInPresets.length,
  renderCount: renderSummaries.length,
  minChangedRatio: Number((renderSummaries.length ? minValue("changedRatio") : 0).toFixed(4)),
  minAverageDelta: Number((renderSummaries.length ? minValue("averageDelta") : 0).toFixed(2)),
  minAverageLuma: Number((renderSummaries.length ? minValue("averageLuma") : 0).toFixed(2)),
  maxAverageLuma: Number((renderSummaries.length ? maxValue("averageLuma") : 0).toFixed(2)),
  minEncodedBytes: renderSummaries.length ? minValue("encodedBytes") : 0,
  findings
};

console.log(JSON.stringify(summary, null, 2));
if (findings.length > 0) process.exitCode = 1;
