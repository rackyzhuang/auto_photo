import fs from "node:fs";
import path from "node:path";

const workspace = process.cwd();

const read = (relativePath) => fs.readFileSync(path.join(workspace, relativePath), "utf8");

const sources = {
  app: read(path.join("src", "App.tsx")),
  desktopBridge: read(path.join("src", "services", "desktopBridge.ts")),
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

requireIncludes("desktopBridge", [
  "export const chooseExportDirectory",
  "directory: true",
  "title: \"选择导出文件夹\""
]);

requireIncludes("app", [
  "showDirectoryPicker",
  "isBrowserDirectoryPickerSupported",
  "window.showDirectoryPicker?.({ mode: \"readwrite\" })",
  "setStatus(\"请选择下载文件夹\")",
  "setStatus(\"已取消选择导出目录，导出未开始\")",
  "setStatus(\"已取消选择下载文件夹，导出未开始\")",
  "setStatus(`浏览器不支持选择文件夹，将使用${BROWSER_DEFAULT_DOWNLOAD_TARGET}`)",
  "return BROWSER_DEFAULT_DOWNLOAD_TARGET",
  "return chooseDirectory()",
  "data-testid=\"export-directory-button\"",
  "data-testid=\"export-target\"",
  "data-testid=\"export-current-button\"",
  "data-testid=\"export-batch-button\"",
  "formatExportJobDetail",
  "sanitizeAiFailureReason(failed.reason)",
  "data-testid={`export-history-detail-${index}`}",
  "className=\"export-history-path\"",
  "选择导出目录",
  "选择下载文件夹",
  "桌面导出目录",
  "浏览器写入文件夹",
  "浏览器下载位置",
  "导出前会先选择文件夹",
  "导出前会先选择下载文件夹",
  "使用${BROWSER_DEFAULT_DOWNLOAD_TARGET}"
]);

requireIncludes("uiDiagnostics", [
  "assertExportTargetLayout",
  "assertDirectoryButtonLayout",
  "[data-testid=\"export-target\"]",
  "[data-testid=\"export-directory-button\"]",
  "Export target value is empty"
]);

requireIncludes("styles", [
  ".export-history-detail",
  ".export-history-path",
  "text-overflow: ellipsis",
  "white-space: nowrap"
]);

requireIncludes("readme", [
  "Desktop mode can write JPG files to a selected export folder",
  "Browser mode falls back to browser downloads"
]);

requireIncludes("readmeCn", [
  "桌面模式可以选择导出目录",
  "浏览器模式会降级为浏览器下载"
]);

const directoryButtonIndex = sources.app.indexOf("data-testid=\"export-directory-button\"");
const exportTargetIndex = sources.app.indexOf("data-testid=\"export-target\"");
if (directoryButtonIndex < 0 || exportTargetIndex < 0 || directoryButtonIndex > exportTargetIndex) {
  findings.push("app: export directory button should render before export target status");
}

const ensureDirectoryIndex = sources.app.indexOf("const ensureExportDirectory");
const browserPromptIndex = sources.app.indexOf("setStatus(\"请选择下载文件夹\")");
const chooseDirectoryIndex = sources.app.indexOf("return chooseDirectory()", ensureDirectoryIndex);
if (ensureDirectoryIndex < 0 || browserPromptIndex < ensureDirectoryIndex || chooseDirectoryIndex < browserPromptIndex) {
  findings.push("app: browser export should prompt for a download folder before exporting when supported");
}

const desktopCancelIndex = sources.app.indexOf("setStatus(\"已取消选择导出目录，导出未开始\")");
const browserCancelIndex = sources.app.indexOf("setStatus(\"已取消选择下载文件夹，导出未开始\")");
const browserDefaultIndex = sources.app.indexOf("return BROWSER_DEFAULT_DOWNLOAD_TARGET", ensureDirectoryIndex);
if (desktopCancelIndex < 0 || browserCancelIndex < desktopCancelIndex) {
  findings.push("app: directory selection cancellation should leave a clear non-exporting status");
}
if (browserDefaultIndex < ensureDirectoryIndex) {
  findings.push("app: unsupported browser directory picker should explicitly use the default download location as export target");
}

const detailIndex = sources.app.indexOf("data-testid={`export-history-detail-${index}`}");
const pathIndex = sources.app.indexOf("className=\"export-history-path\"");
if (detailIndex < 0 || pathIndex < 0 || detailIndex > pathIndex) {
  findings.push("app: export history should show item/failure detail before the output path");
}
if (!sources.uiDiagnostics.includes("Export history leaked secret-looking detail")) {
  findings.push("uiDiagnostics: export history diagnostics should assert secret-looking details are redacted");
}

const summary = {
  status: findings.length > 0 ? "failed" : "passed",
  checks: 55,
  findings
};

console.log(JSON.stringify(summary, null, 2));
if (findings.length > 0) process.exitCode = 1;
