import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const workspace = process.cwd();
const artifactDir = path.join(workspace, "remark-V2", "artifacts", "preset-contact-sheets");
const manifestPath = path.join(artifactDir, "preset-contact-manifest.json");
const htmlPath = path.join(artifactDir, "index.html");

const loadEditParamsModule = async () => {
  const sourcePath = path.join(workspace, "src", "services", "editParams.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);
};

const { builtInPresets } = await loadEditParamsModule();

const findings = [];
const fail = (message) => findings.push(message);
const exists = (filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile();
const isJpeg = (filePath) => {
  if (!exists(filePath)) return false;
  const bytes = fs.readFileSync(filePath);
  return bytes.length > 4096 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
};

if (!exists(manifestPath)) fail("preset-contact-manifest.json missing");
if (!exists(htmlPath)) fail("index.html missing");

const manifest = exists(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { sheets: [] };
const html = exists(htmlPath) ? fs.readFileSync(htmlPath, "utf8") : "";
const sheets = Array.isArray(manifest.sheets) ? manifest.sheets : [];

if (!Array.isArray(builtInPresets) || builtInPresets.length === 0) fail("builtInPresets is empty");
if (manifest.presetCount !== builtInPresets.length) fail(`manifest presetCount mismatch: ${manifest.presetCount}`);
if (manifest.sheetCount !== sheets.length) fail(`manifest sheetCount mismatch: ${manifest.sheetCount}`);
if (sheets.length !== 2) fail(`expected 2 contact sheets, got ${sheets.length}`);

const expectedPresetIds = builtInPresets.map((preset) => preset.id);
const requiredBrands = new Set(["Nikon", "Sony"]);
const seenBrands = new Set();

for (const sheet of sheets) {
  const label = sheet.sampleBrand ?? sheet.sampleName ?? "unknown-sheet";
  seenBrands.add(sheet.sampleBrand);
  const relativeFile = String(sheet.file ?? "");
  const imagePath = path.join(workspace, relativeFile);
  if (!relativeFile.startsWith("remark-V2/artifacts/preset-contact-sheets/")) fail(`${label}: unexpected image path`);
  if (!isJpeg(imagePath)) fail(`${label}: contact sheet JPG missing or invalid`);
  if (sheet.width !== 1048 || sheet.height !== 718) fail(`${label}: unexpected sheet dimensions`);
  if (!Array.isArray(sheet.cells) || sheet.cells.length !== builtInPresets.length) fail(`${label}: cell count mismatch`);

  const cellIds = (sheet.cells ?? []).map((cell) => cell.presetId);
  for (const [index, expectedId] of expectedPresetIds.entries()) {
    const cell = sheet.cells?.[index];
    if (!cell) continue;
    if (cell.cellIndex !== index + 1) fail(`${label}: cellIndex mismatch at ${index + 1}`);
    if (cell.presetId !== expectedId) fail(`${label}: preset order mismatch at ${index + 1}`);
    if (cell.name !== builtInPresets[index].name) fail(`${label}: preset name mismatch at ${index + 1}`);
    if (cell.series !== builtInPresets[index].series) fail(`${label}: preset series mismatch at ${index + 1}`);
  }
  if (new Set(cellIds).size !== cellIds.length) fail(`${label}: duplicate preset id in cells`);
  if (!html.includes(path.basename(relativeFile))) fail(`${label}: HTML does not reference image`);
}

for (const brand of requiredBrands) {
  if (!seenBrands.has(brand)) fail(`missing ${brand} contact sheet`);
}

const rowCount = (html.match(/<tr>/g) ?? []).length;
const expectedRowCount = sheets.length * (builtInPresets.length + 1);
if (rowCount !== expectedRowCount) fail(`HTML row count mismatch: ${rowCount}`);
if (/<script\b/i.test(html)) fail("HTML must not include script tags");
if (/https?:\/\//i.test(html)) fail("HTML must not include external URLs");
if (!html.includes("Auto Photo Preset Contact Sheets")) fail("HTML title missing");
if (!html.includes("portrait-natural") || !html.includes("creative-bw-documentary")) fail("HTML preset id bounds missing");

const summary = {
  status: findings.length > 0 ? "failed" : "passed",
  presetCount: builtInPresets.length,
  sheetCount: sheets.length,
  htmlRows: rowCount,
  files: sheets.map((sheet) => sheet.file),
  findings
};

console.log(JSON.stringify(summary, null, 2));
if (findings.length > 0) process.exitCode = 1;
