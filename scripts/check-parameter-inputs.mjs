import fs from "node:fs";
import path from "node:path";

const workspace = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(workspace, relativePath), "utf8");

const sources = {
  app: read(path.join("src", "App.tsx")),
  styles: read(path.join("src", "styles.css")),
  uiDiagnostics: read(path.join("src", "diagnostics", "phase5UiDiagnostics.tsx")),
  presets: read(path.join("src", "services", "editParams.ts"))
};

const findings = [];
const requireIncludes = (sourceName, fragments) => {
  const source = sources[sourceName];
  for (const fragment of fragments) {
    if (!source.includes(fragment)) findings.push(`${sourceName}: missing ${fragment}`);
  }
};

requireIncludes("app", [
  "normalizeControlValue",
  "clamp(roundToStep(nextValue, control.step ?? 1), control.min, control.max)",
  "normalizeHslValue",
  "data-testid={`edit-range-${control.key}`}",
  "data-testid={`edit-number-${control.key}`}",
  "type=\"number\"",
  "min={control.min}",
  "max={control.max}",
  "onFocus={beginEditDraft}",
  "onBlur={() => commitEditDraft([\"已调整调色参数\"])}",
  "if (event.key === \"Enter\")",
  "data-testid={`hsl-number-${channel}-hue`}",
  "data-testid={`hsl-number-${channel}-saturation`}",
  "data-testid={`hsl-number-${channel}-luminance`}",
  "normalizeEditParams(copiedParams)",
  "已批量粘贴调色参数"
]);

requireIncludes("styles", [
  ".slider-input-row",
  "grid-template-columns: minmax(0, 1fr) 64px",
  ".control-number",
  "min-width: 0",
  "font-variant-numeric: tabular-nums",
  ".mini-number"
]);

requireIncludes("uiDiagnostics", [
  "const MOVES_PER_SLIDER = 20",
  "const HSL_MOVES_PER_RANGE = 8",
  "${SLIDER_KEYS.length} sliders x ${MOVES_PER_SLIDER} moves",
  "${HSL_RANGE_KEYS.length} HSL ranges x ${HSL_MOVES_PER_RANGE} moves",
  "edit-range-exposure",
  "hsl-range-red-hue"
]);

requireIncludes("presets", [
  "export const builtInPresets",
  "normalizeEditParams"
]);

const numberIndex = sources.app.indexOf("data-testid={`edit-number-${control.key}`}");
const blurIndex = sources.app.indexOf("onBlur={() => commitEditDraft([\"已调整调色参数\"])}", numberIndex);
const enterIndex = sources.app.indexOf("if (event.key === \"Enter\")", blurIndex);
if (numberIndex < 0 || blurIndex < numberIndex || enterIndex < blurIndex) {
  findings.push("app: edit number input should have a stable test id, blur commit, and Enter-to-blur behavior");
}

const batchPasteIndex = sources.app.indexOf("const pasteParamsToBatch");
const normalizeBatchPasteIndex = sources.app.indexOf("edits: normalizeEditParams(copiedParams)", batchPasteIndex);
if (batchPasteIndex < 0 || normalizeBatchPasteIndex < batchPasteIndex) {
  findings.push("app: batch paste should normalize copied params before applying to assets");
}

const summary = {
  status: findings.length > 0 ? "failed" : "passed",
  checks: 30,
  findings
};

console.log(JSON.stringify(summary, null, 2));
if (findings.length > 0) process.exitCode = 1;
