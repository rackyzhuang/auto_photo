import fs from "node:fs";
import path from "node:path";

const workspace = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(workspace, relativePath), "utf8");

const sources = {
  app: read(path.join("src", "App.tsx")),
  styles: read(path.join("src", "styles.css")),
  uiDiagnostics: read(path.join("src", "diagnostics", "phase5UiDiagnostics.tsx")),
  readme: read("README.md"),
  readmeCn: read("README_CN.md")
};

const findings = [];
const requireIncludes = (sourceName, fragments) => {
  const source = sources[sourceName];
  for (const fragment of fragments) {
    if (!source.includes(fragment)) findings.push(`${sourceName}: missing ${fragment}`);
  }
};

requireIncludes("app", [
  "data-testid=\"compare-mode-button\"",
  "compareMode === \"split\"",
  "data-testid=\"compare-view\"",
  "className=\"compare-edited-layer\"",
  "clipPath: `inset(0 ${100 - compareSplit}% 0 0)`",
  "className=\"compare-divider\"",
  "left: `${compareSplit}%`",
  "data-testid=\"compare-slider\"",
  "min={5}",
  "max={95}",
  "onChange={(event) => setCompareSplit(Number(event.target.value))}",
  "className=\"image-stage\" data-testid=\"image-stage\" onDoubleClick={(event) => event.preventDefault()}",
  "className=\"edit-panel\""
]);

requireIncludes("styles", [
  "grid-template-columns: minmax(240px, 300px) minmax(0, 1fr) minmax(300px, 360px)",
  ".library-panel,\n.edit-panel",
  "position: relative",
  "z-index: 2",
  ".preview-panel",
  "z-index: 0",
  "grid-template-columns: minmax(0, 1fr)",
  "overflow: hidden",
  "isolation: isolate",
  ".image-stage",
  "contain: layout paint",
  ".compare-view",
  "max-width: 100%",
  "max-height: 100%",
  "isolation: isolate",
  ".compare-image",
  "object-fit: contain",
  "pointer-events: none",
  "user-select: none",
  ".compare-edited-layer",
  "z-index: 1",
  ".compare-divider",
  "z-index: 2",
  ".compare-label",
  "pointer-events: none",
  ".compare-slider",
  "left: 18px",
  "right: 18px",
  "width: calc(100% - 36px)",
  "z-index: 4",
  "touch-action: pan-x",
  ".edit-panel",
  "overflow-y: auto"
]);

requireIncludes("uiDiagnostics", [
  "assertPreviewPanelBounds",
  "assertCompareLayout",
  "Preview panel overlaps edit panel",
  "Edit panel stacking order is not above preview panel",
  "Edit panel escapes app shell",
  "App shell horizontal overflow",
  "Compare view overflow",
  "Compare slider escapes compare view",
  "Compare divider mismatch",
  "Compare edited layer clip not updated",
  "split compare layout and right panel bounds",
  "for (const split of [25, 50, 75])",
  "compare view closed"
]);

requireIncludes("readme", ["before/after comparison"]);
requireIncludes("readmeCn", ["前后对比"]);

const styles = sources.styles;
const compareViewIndex = styles.indexOf(".compare-view");
const compareSliderIndex = styles.indexOf(".compare-slider");
const editPanelScrollRule = /(?:^|\n)\.edit-panel\s*\{[^}]*overflow-y:\s*auto[^}]*\}/.test(styles);
const panelStackingRule = /(?:^|\n)\.library-panel,\s*\n\.edit-panel\s*\{[^}]*position:\s*relative[^}]*z-index:\s*2[^}]*\}/.test(styles);
const previewIsolationRule = /(?:^|\n)\.preview-panel\s*\{[^}]*position:\s*relative[^}]*z-index:\s*0[^}]*isolation:\s*isolate[^}]*\}/.test(styles);
if (compareViewIndex < 0 || compareSliderIndex < compareViewIndex) {
  findings.push("styles: compare slider should be scoped after compare view styles");
}
if (!editPanelScrollRule) {
  findings.push("styles: edit panel should remain independently scrollable");
}
if (!panelStackingRule) {
  findings.push("styles: library/edit panels should have explicit stacking above preview panel");
}
if (!previewIsolationRule) {
  findings.push("styles: preview panel should be an isolated stacking context below side panels");
}

const app = sources.app;
const compareViewMarkupIndex = app.indexOf("data-testid=\"compare-view\"");
const sliderMarkupIndex = app.indexOf("data-testid=\"compare-slider\"", compareViewMarkupIndex);
const endCompareViewIndex = app.indexOf("</div>", sliderMarkupIndex);
if (compareViewMarkupIndex < 0 || sliderMarkupIndex < compareViewMarkupIndex || endCompareViewIndex < sliderMarkupIndex) {
  findings.push("app: compare slider should render inside compare view");
}
if (!app.includes("data-testid=\"image-stage\" onDoubleClick={(event) => event.preventDefault()}")) {
  findings.push("app: image stage should prevent default double-click behavior inside the preview column");
}

const diagnostics = sources.uiDiagnostics;
const boundsIndex = diagnostics.indexOf("assertPreviewPanelBounds();");
const viewOverflowIndex = diagnostics.indexOf("Compare view overflow", boundsIndex);
const sliderBoundsIndex = diagnostics.indexOf("Compare slider escapes compare view", viewOverflowIndex);
if (boundsIndex < 0 || viewOverflowIndex < boundsIndex || sliderBoundsIndex < viewOverflowIndex) {
  findings.push("uiDiagnostics: compare layout should check panel bounds before compare control bounds");
}

const summary = {
  status: findings.length > 0 ? "failed" : "passed",
  checks: 70,
  findings
};

console.log(JSON.stringify(summary, null, 2));
if (findings.length > 0) process.exitCode = 1;
