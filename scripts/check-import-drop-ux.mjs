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

requireIncludes("app", [
  "data-testid=\"photo-import-input\"",
  "accept=\".jpg,.jpeg,.arw,.nef,image/jpeg\"",
  "拖入 Sony/Nikon JPG 或 RAW",
  "松开鼠标开始导入",
  "选择照片文件",
  "不支持的格式，仅支持 JPG/JPEG、Sony ARW、Nikon NEF",
  "const MAX_DESKTOP_IMPORT_PATHS = 24",
  "const supportedDesktopPhotoExtensions = new Set([\"jpg\", \"jpeg\", \"arw\", \"nef\"])",
  "const isSupportedDesktopPhotoPath",
  "const supportedPaths = filePaths.filter(isSupportedDesktopPhotoPath)",
  "unsupportedPathFailures",
  "overflowFailures",
  "一次最多导入 ${MAX_DESKTOP_IMPORT_PATHS} 个文件，请分批导入",
  "await importFiles([], presetFailed, filePaths.length)",
  "正在读取 ${limitedPaths.length} 个桌面文件",
  "const desktopReadFailures",
  "for (const filePath of limitedPaths)",
  "readPhotoFiles([filePath])",
  "const desktopPayloadFailures",
  "files.push(desktopPhotoPayloadToFile(photo))",
  "await importFiles(files, [...presetFailed, ...desktopReadFailures, ...desktopPayloadFailures], filePaths.length)",
  "Imported JPG ${jpgCount}, RAW ${rawCount}",
  "originals unchanged",
  "onDragOver={handleDragOver}",
  "onDragLeave={handleDragLeave}",
  "onDrop={handleDrop}",
  "event.dataTransfer.types.includes(\"Files\")",
  "event.dataTransfer.dropEffect = \"copy\"",
  "importFiles(event.dataTransfer.files)",
  "onDesktopPhotoDragDrop((event)",
  "event.type === \"enter\" || event.type === \"over\"",
  "event.type === \"drop\"",
  "importDesktopPhotoPathsRef.current(event.paths)",
  "setIsDragActive(false)"
]);

requireIncludes("desktopBridge", [
  "export const choosePhotoFilePaths",
  "title: \"选择 Sony/Nikon JPG 或 RAW\"",
  "extensions: [\"jpg\", \"jpeg\", \"arw\", \"nef\"]",
  "export const readPhotoFiles",
  "export const onDesktopPhotoDragDrop",
  "getCurrentWindow().onDragDropEvent"
]);

requireIncludes("styles", [
  ".app-shell.drag-active .preview-panel",
  ".app-shell.drag-active .library-panel",
  ".drop-zone",
  ".drop-zone.active",
  "border: 1px dashed",
  "background: rgba(143, 191, 232, 0.18)",
  ".import-report",
  "overflow-wrap: anywhere"
]);

requireIncludes("uiDiagnostics", [
  "[data-testid=\"photo-import-input\"]",
  "import ${SAMPLE_COUNT} samples through App UI",
  "document.querySelectorAll(\".asset-row\").length === SAMPLE_COUNT",
  "after ui import"
]);

requireIncludes("readme", [
  "JPG/JPEG import, drag-and-drop import",
  "RAW `.ARW` and `.NEF` files can be imported",
  "`npm run check:desktop-import-paths` passes"
]);

requireIncludes("readmeCn", [
  "拖拽导入",
  "RAW `.ARW` 和 `.NEF` 当前可以导入",
  "`npm run check:desktop-import-paths` 可以通过"
]);

const app = sources.app;
const dragOverIndex = app.indexOf("const handleDragOver");
const dropEffectIndex = app.indexOf("event.dataTransfer.dropEffect = \"copy\"", dragOverIndex);
const setDragActiveIndex = app.indexOf("setIsDragActive(true)", dragOverIndex);
if (dragOverIndex < 0 || dropEffectIndex < dragOverIndex || setDragActiveIndex < dropEffectIndex) {
  findings.push("app: browser drag-over should set copy dropEffect before activating drag highlight");
}

const tauriDropIndex = app.indexOf("event.type === \"drop\"");
const clearDragIndex = app.indexOf("setIsDragActive(false)", tauriDropIndex);
const importPathsIndex = app.indexOf("importDesktopPhotoPathsRef.current(event.paths)", tauriDropIndex);
if (tauriDropIndex < 0 || clearDragIndex < tauriDropIndex || importPathsIndex < clearDragIndex) {
  findings.push("app: Tauri drop should clear drag highlight before importing dropped paths");
}

const desktopFilterIndex = app.indexOf("const supportedPaths = filePaths.filter(isSupportedDesktopPhotoPath)");
const desktopLimitIndex = app.indexOf("const limitedPaths = supportedPaths.slice(0, MAX_DESKTOP_IMPORT_PATHS)", desktopFilterIndex);
const desktopReadLoopIndex = app.indexOf("for (const filePath of limitedPaths)", desktopLimitIndex);
const desktopReadIndex = app.indexOf("readPhotoFiles([filePath])", desktopReadLoopIndex);
const desktopReadFailureIndex = app.indexOf("desktopReadFailures.push", desktopReadIndex);
const desktopPayloadFailureIndex = app.indexOf("desktopPayloadFailures.push", desktopReadFailureIndex);
const desktopImportIndex = app.indexOf(
  "await importFiles(files, [...presetFailed, ...desktopReadFailures, ...desktopPayloadFailures], filePaths.length)",
  desktopPayloadFailureIndex
);
if (
  desktopFilterIndex < 0 ||
  desktopLimitIndex < desktopFilterIndex ||
  desktopReadLoopIndex < desktopLimitIndex ||
  desktopReadIndex < desktopReadLoopIndex ||
  desktopReadFailureIndex < desktopReadIndex ||
  desktopPayloadFailureIndex < desktopReadFailureIndex ||
  desktopImportIndex < desktopPayloadFailureIndex
) {
  findings.push("app: desktop drag/drop should filter and limit paths, read each path independently, and merge read/payload failures into import report");
}

const inputIndex = app.indexOf("data-testid=\"photo-import-input\"");
const dropZoneIndex = app.indexOf("className={`drop-zone${isDragActive ? \" active\" : \"\"}`");
if (inputIndex < 0 || dropZoneIndex < inputIndex) {
  findings.push("app: drop zone should render after the import input control");
}

const summary = {
  status: findings.length > 0 ? "failed" : "passed",
  checks: 70,
  findings
};

console.log(JSON.stringify(summary, null, 2));
if (findings.length > 0) process.exitCode = 1;
