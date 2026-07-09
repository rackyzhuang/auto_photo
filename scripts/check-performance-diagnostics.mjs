import fs from "node:fs";
import path from "node:path";

const workspace = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(workspace, relativePath), "utf8");

const sources = {
  main: read(path.join("src", "main.tsx")),
  diagnostics: read(path.join("src", "diagnostics", "phase5Diagnostics.ts")),
  desktopDiagnostics: read(path.join("src", "diagnostics", "phase5DesktopDiagnostics.ts")),
  desktopBridge: read(path.join("src", "services", "desktopBridge.ts")),
  rust: read(path.join("src-tauri", "src", "lib.rs"))
};

const findings = [];
const requireIncludes = (sourceName, fragments) => {
  const source = sources[sourceName];
  for (const fragment of fragments) {
    if (!source.includes(fragment)) findings.push(`${sourceName}: missing ${fragment}`);
  }
};

requireIncludes("main", [
  "devDiagnostics === \"phase5\" || devDiagnostics === \"phase5-process\"",
  "runPhase5Diagnostics"
]);

requireIncludes("diagnostics", [
  "memorySamples: MemorySample[]",
  "resourceSnapshots: ResourceSnapshot[]",
  "processSamples: ProcessResourceSnapshot[]",
  "stabilityMemoryTrend?: StabilityMemoryTrend",
  "VITE_AUTO_PHOTO_PHASE5_STABILITY_CYCLES",
  "VITE_AUTO_PHOTO_PHASE5_STABILITY_SAMPLE_COUNT",
  "VITE_AUTO_PHOTO_PHASE5_STABILITY_RENDER_COUNT",
  "createObjectUrlMonitor",
  "activeObjectUrls",
  "getProcessResourceSample",
  "analyzeStabilityMemoryTrend",
  "workingSetDeltaBytes",
  "privateMemoryDeltaBytes",
  "Cleanup memory growth stayed within",
  "disposePreviewWorker()",
  "saveDiagnosticReport(\"phase5-process\", report)"
]);

requireIncludes("desktopBridge", [
  "export const getProcessResourceSample",
  "invoke<ProcessResourceSample>(\"get_process_resource_sample\")"
]);

requireIncludes("rust", [
  "fn read_process_resource_sample()",
  "working_set_bytes",
  "peak_working_set_bytes",
  "private_memory_bytes",
  "fn get_process_resource_sample()",
  "process_resource_sample_reports_current_process"
]);

requireIncludes("desktopDiagnostics", [
  "capture process resource sample",
  "processSampleCaptured",
  "workingSetBytes"
]);

const trendIndex = sources.diagnostics.indexOf("report.stabilityMemoryTrend = analyzeStabilityMemoryTrend(report)");
const statusIndex = sources.diagnostics.indexOf("report.summary.stabilityMemoryTrendStatus = report.stabilityMemoryTrend.status", trendIndex);
const saveIndex = sources.diagnostics.indexOf("saveDiagnosticReport(\"phase5-process\", report)", statusIndex);
if (trendIndex < 0 || statusIndex < trendIndex || saveIndex < statusIndex) {
  findings.push("diagnostics: phase5 process report should analyze trend before saving the report");
}

const summary = {
  status: findings.length > 0 ? "failed" : "passed",
  checks: 38,
  findings
};

console.log(JSON.stringify(summary, null, 2));
if (findings.length > 0) process.exitCode = 1;
