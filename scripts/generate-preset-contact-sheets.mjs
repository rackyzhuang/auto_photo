import fs from "node:fs";
import path from "node:path";
import jpeg from "jpeg-js";
import ts from "typescript";

const workspace = process.cwd();
const manifestPath = path.join(workspace, "image", "generated-jpg", "sample-manifest.json");
const outputDir = path.join(workspace, "remark-V2", "artifacts", "preset-contact-sheets");

const columns = 5;
const tileWidth = 200;
const tileHeight = 134;
const gap = 8;
const stripeHeight = 6;
const background = [245, 246, 248, 255];
const border = [214, 219, 226, 255];
const badgeBackground = [20, 24, 31, 225];
const badgeForeground = [255, 255, 255, 255];
const seriesColors = {
  "\u4eba\u50cf": [229, 115, 115, 255],
  "\u98ce\u5149": [86, 160, 106, 255],
  "\u5efa\u7b51": [103, 125, 151, 255],
  "\u57ce\u5e02": [73, 132, 184, 255],
  "\u4e2a\u6027": [156, 112, 177, 255]
};

const digitGlyphs = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"]
};

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

const ensureCleanOutputDir = () => {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const entry of fs.readdirSync(outputDir)) {
    if (
      /^preset-contact-(nikon|sony)-.*\.(jpg|json)$/i.test(entry) ||
      entry === "preset-contact-manifest.json" ||
      entry === "index.html"
    ) {
      fs.rmSync(path.join(outputDir, entry), { force: true });
    }
  }
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const setPixel = (data, width, x, y, rgba) => {
  if (x < 0 || y < 0 || x >= width) return;
  const index = (y * width + x) * 4;
  data[index] = rgba[0];
  data[index + 1] = rgba[1];
  data[index + 2] = rgba[2];
  data[index + 3] = rgba[3];
};

const fillRect = (image, x, y, width, height, rgba) => {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      setPixel(image.data, image.width, xx, yy, rgba);
    }
  }
};

const drawDigit = (image, digit, x, y, scale, rgba) => {
  const glyph = digitGlyphs[digit];
  if (!glyph) return;
  for (let row = 0; row < glyph.length; row += 1) {
    for (let column = 0; column < glyph[row].length; column += 1) {
      if (glyph[row][column] !== "1") continue;
      fillRect(image, x + column * scale, y + row * scale, scale, scale, rgba);
    }
  }
};

const drawNumberBadge = (image, number, x, y) => {
  const text = String(number).padStart(2, "0");
  const scale = 2;
  const digitWidth = 3 * scale;
  const digitHeight = 5 * scale;
  const digitGap = 2;
  const paddingX = 4;
  const paddingY = 3;
  const badgeWidth = paddingX * 2 + text.length * digitWidth + (text.length - 1) * digitGap;
  const badgeHeight = paddingY * 2 + digitHeight;

  fillRect(image, x, y, badgeWidth, badgeHeight, badgeBackground);
  for (const [index, digit] of [...text].entries()) {
    drawDigit(image, digit, x + paddingX + index * (digitWidth + digitGap), y + paddingY, scale, badgeForeground);
  }
};

const drawImage = (target, source, x, y) => {
  for (let yy = 0; yy < source.height; yy += 1) {
    for (let xx = 0; xx < source.width; xx += 1) {
      const sourceIndex = (yy * source.width + xx) * 4;
      const targetIndex = ((y + yy) * target.width + x + xx) * 4;
      target.data[targetIndex] = source.data[sourceIndex];
      target.data[targetIndex + 1] = source.data[sourceIndex + 1];
      target.data[targetIndex + 2] = source.data[sourceIndex + 2];
      target.data[targetIndex + 3] = 255;
    }
  }
};

const createThumbnail = (decoded, maxWidth, maxHeight) => {
  const scale = Math.min(maxWidth / decoded.width, maxHeight / decoded.height);
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(decoded.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(decoded.width - 1, Math.floor(x / scale));
      const sourceIndex = (sourceY * decoded.width + sourceX) * 4;
      const targetIndex = (y * width + x) * 4;
      data[targetIndex] = decoded.data[sourceIndex];
      data[targetIndex + 1] = decoded.data[sourceIndex + 1];
      data[targetIndex + 2] = decoded.data[sourceIndex + 2];
      data[targetIndex + 3] = 255;
    }
  }

  return { data, width, height };
};

const createSheet = (sample, decoded) => {
  const rows = Math.ceil(builtInPresets.length / columns);
  const width = columns * tileWidth + (columns + 1) * gap;
  const height = rows * tileHeight + (rows + 1) * gap;
  const sheet = {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height
  };
  fillRect(sheet, 0, 0, width, height, background);

  const cells = [];
  for (const [index, preset] of builtInPresets.entries()) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const tileX = gap + column * (tileWidth + gap);
    const tileY = gap + row * (tileHeight + gap);
    const contentX = tileX + 1;
    const contentY = tileY + stripeHeight + 1;
    const contentWidth = tileWidth - 2;
    const contentHeight = tileHeight - stripeHeight - 2;

    fillRect(sheet, tileX, tileY, tileWidth, tileHeight, border);
    fillRect(sheet, contentX, contentY, contentWidth, contentHeight, [255, 255, 255, 255]);
    fillRect(sheet, tileX + 1, tileY + 1, tileWidth - 2, stripeHeight, seriesColors[preset.series] ?? [140, 140, 140, 255]);

    const thumbnail = createThumbnail(decoded, contentWidth, contentHeight);
    const imageData = {
      data: new Uint8ClampedArray(thumbnail.data),
      width: thumbnail.width,
      height: thumbnail.height
    };
    applyEditPipeline(imageData, normalizeEditParams(preset.params));
    const pasteX = contentX + Math.floor((contentWidth - imageData.width) / 2);
    const pasteY = contentY + Math.floor((contentHeight - imageData.height) / 2);
    drawImage(sheet, imageData, pasteX, pasteY);
    drawNumberBadge(sheet, index + 1, tileX + 6, tileY + 10);

    cells.push({
      cellIndex: index + 1,
      row: row + 1,
      column: column + 1,
      presetId: preset.id,
      series: preset.series,
      name: preset.name,
      description: preset.description
    });
  }

  const slug = String(sample.brand ?? sample.name ?? "sample")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const fileName = `preset-contact-${slug || "sample"}.jpg`;
  const encoded = jpeg.encode(
    {
      data: Buffer.from(sheet.data),
      width: sheet.width,
      height: sheet.height
    },
    88
  );
  fs.writeFileSync(path.join(outputDir, fileName), encoded.data);

  return {
    sampleName: sample.name,
    sampleBrand: sample.brand,
    source: String(sample.output ?? "").replaceAll("\\", "/"),
    file: path.join("remark-V2", "artifacts", "preset-contact-sheets", fileName).replaceAll("\\", "/"),
    width: sheet.width,
    height: sheet.height,
    bytes: encoded.data.length,
    columns,
    rows,
    cells
  };
};

const createHtmlReviewPage = (manifest) => {
  const legendItems = Object.entries(seriesColors)
    .map(
      ([series, color]) =>
        `<span class="legend-item"><span class="swatch" style="background: rgb(${color[0]}, ${color[1]}, ${color[2]})"></span>${escapeHtml(series)}</span>`
    )
    .join("");

  const sheetSections = manifest.sheets
    .map((sheet) => {
      const imageName = path.basename(sheet.file);
      const rows = sheet.cells
        .map(
          (cell) => `<tr>
            <td class="cell-index">${String(cell.cellIndex).padStart(2, "0")}</td>
            <td>${escapeHtml(cell.series)}</td>
            <td><code>${escapeHtml(cell.presetId)}</code></td>
            <td>${escapeHtml(cell.name)}</td>
            <td>${escapeHtml(cell.description)}</td>
          </tr>`
        )
        .join("");
      return `<section class="sheet">
        <div class="sheet-header">
          <h2>${escapeHtml(sheet.sampleBrand)} Fixture</h2>
          <p>${escapeHtml(sheet.sampleName)} · ${sheet.cells.length} presets · ${sheet.columns} x ${sheet.rows}</p>
        </div>
        <img src="${escapeHtml(imageName)}" alt="${escapeHtml(sheet.sampleBrand)} preset contact sheet" width="${sheet.width}" height="${sheet.height}" />
        <table>
          <thead>
            <tr>
              <th>No.</th>
              <th>Series</th>
              <th>Preset ID</th>
              <th>Name</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Auto Photo Preset Contact Sheets</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, "Segoe UI", Arial, sans-serif;
      color: #1f2933;
      background: #f5f6f8;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 32px;
    }
    header,
    .sheet {
      max-width: 1120px;
      margin: 0 auto 28px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      line-height: 1.2;
    }
    h2 {
      margin: 0;
      font-size: 20px;
    }
    p {
      margin: 6px 0 0;
      color: #5f6b7a;
      line-height: 1.5;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 16px;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      border: 1px solid #d9dee7;
      background: #fff;
      border-radius: 6px;
      font-size: 13px;
    }
    .swatch {
      width: 14px;
      height: 8px;
      border-radius: 999px;
      display: inline-block;
    }
    .sheet {
      padding: 18px;
      border: 1px solid #d9dee7;
      border-radius: 8px;
      background: #fff;
    }
    .sheet-header {
      margin-bottom: 14px;
    }
    img {
      display: block;
      width: 100%;
      height: auto;
      border: 1px solid #e1e5ec;
      border-radius: 6px;
      background: #f8fafc;
    }
    table {
      width: 100%;
      margin-top: 16px;
      border-collapse: collapse;
      font-size: 13px;
    }
    th,
    td {
      padding: 8px 10px;
      border-bottom: 1px solid #e7ebf0;
      text-align: left;
      vertical-align: top;
    }
    th {
      color: #52606d;
      background: #f7f9fb;
      font-weight: 700;
    }
    .cell-index {
      font-weight: 800;
      color: #111827;
      white-space: nowrap;
    }
    code {
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 12px;
    }
    @media (max-width: 720px) {
      body {
        padding: 16px;
      }
      .sheet {
        padding: 12px;
      }
      table {
        font-size: 12px;
      }
      th,
      td {
        padding: 7px 6px;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>Auto Photo Preset Contact Sheets</h1>
    <p>Generated at ${escapeHtml(manifest.generatedAt)}. Use each visible cell number to review the preset mapping below.</p>
    <div class="legend">${legendItems}</div>
  </header>
  ${sheetSections}
</body>
</html>
`;
};

if (!fs.existsSync(manifestPath)) {
  console.error("PRESET_CONTACT_SHEET_MISSING_FIXTURES run_prepare_first=true");
  process.exit(1);
}

const sourceManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const samples = Array.isArray(sourceManifest.samples) ? sourceManifest.samples : [];
if (samples.length === 0) {
  console.error("PRESET_CONTACT_SHEET_NO_SAMPLES");
  process.exit(1);
}

ensureCleanOutputDir();

const sheets = [];
for (const sample of samples) {
  const inputPath = path.join(workspace, sample.output ?? "");
  if (!fs.existsSync(inputPath)) {
    console.error(`PRESET_CONTACT_SHEET_SAMPLE_MISSING ${sample.name ?? sample.output}`);
    process.exit(1);
  }
  const decoded = jpeg.decode(fs.readFileSync(inputPath), {
    maxMemoryUsageInMB: 1536,
    useTArray: true
  });
  sheets.push(createSheet(sample, decoded));
}

const manifest = {
  generatedAt: new Date().toISOString(),
  purpose: "Manual visual review baseline for built-in preset direction.",
  sourceManifest: path.relative(workspace, manifestPath).replaceAll("\\", "/"),
  presetCount: builtInPresets.length,
  sheetCount: sheets.length,
  tileWidth,
  tileHeight,
  columns,
  sheets
};

fs.writeFileSync(path.join(outputDir, "preset-contact-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(outputDir, "index.html"), createHtmlReviewPage(manifest), "utf8");

console.log(
  JSON.stringify(
    {
      status: "generated",
      outputDir: path.relative(workspace, outputDir).replaceAll("\\", "/"),
      presetCount: builtInPresets.length,
      sheetCount: sheets.length,
      files: sheets.map((sheet) => sheet.file),
      manifest: "remark-V2/artifacts/preset-contact-sheets/preset-contact-manifest.json",
      reviewPage: "remark-V2/artifacts/preset-contact-sheets/index.html"
    },
    null,
    2
  )
);
