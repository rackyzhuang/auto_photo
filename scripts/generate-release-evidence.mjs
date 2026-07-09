import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const workspace = process.cwd();
const appData = process.env.APPDATA ?? "";
const diagnosticsDir = path.join(appData, "com.autophoto.client", "diagnostics");
const outputPath = path.join(workspace, "remark-V2", "artifacts", "release-evidence.json");
const manualAcceptancePath = path.join(workspace, "remark-V2", "manual-acceptance-results.json");

const artifacts = [
  {
    name: "windows-release-exe",
    path: path.join(workspace, "src-tauri", "target", "release", "auto-photo.exe")
  },
  {
    name: "windows-msi",
    path: path.join(workspace, "src-tauri", "target", "release", "bundle", "msi", "Auto Photo_0.1.0_x64_en-US.msi")
  },
  {
    name: "windows-nsis",
    path: path.join(workspace, "src-tauri", "target", "release", "bundle", "nsis", "Auto Photo_0.1.0_x64-setup.exe")
  }
];

const sensitivePattern = /(https?:\/\/|Bearer\s+|sk-[A-Za-z0-9_-]{8,}|data:image\/[^;]+;base64,)/i;

const sha256File = (filePath) => {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
};

const artifactEvidence = (artifact) => {
  if (!fs.existsSync(artifact.path)) {
    return {
      name: artifact.name,
      path: artifact.path,
      exists: false
    };
  }
  const stat = fs.statSync(artifact.path);
  return {
    name: artifact.name,
    path: artifact.path,
    exists: true,
    sizeBytes: stat.size,
    lastWriteTime: stat.mtime.toISOString(),
    sha256: sha256File(artifact.path)
  };
};

const latestReports = (prefix, limit = 1) => {
  if (!fs.existsSync(diagnosticsDir)) return [];
  return fs
    .readdirSync(diagnosticsDir)
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith(".json"))
    .map((name) => {
      const filePath = path.join(diagnosticsDir, name);
      const stat = fs.statSync(filePath);
      return { name, path: filePath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);
};

const safeMessage = (value) =>
  String(value ?? "")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, "sk-[redacted]")
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, "[redacted-image-data]")
    .slice(0, 240);

const summarizeReport = (reportPath) => {
  const raw = fs.readFileSync(reportPath, "utf8");
  const parsed = JSON.parse(raw);
  const summary = parsed.summary ?? {};
  const result = parsed.result ?? {};
  const diagnostic = parsed.diagnostic ?? {};
  return {
    path: reportPath,
    status: parsed.status ?? summary.status,
    savedReportPath: parsed.savedReportPath,
    diagnosticStatus: summary.diagnosticStatus,
    aiStatus: summary.aiStatus,
    mode: summary.mode,
    model: safeMessage(summary.model ?? result.model ?? diagnostic.model),
    modelAvailable: summary.modelAvailable ?? diagnostic.modelAvailable,
    modelCount: summary.modelCount ?? diagnostic.modelCount,
    hasApiKey: summary.hasApiKey ?? diagnostic.hasApiKey,
    sourceFormat: summary.sourceFormat,
    cameraBrand: summary.cameraBrand,
    previewKind: summary.previewKind,
    referenceSourceFormat: summary.referenceSourceFormat,
    referenceCameraBrand: summary.referenceCameraBrand,
    referencePreviewKind: summary.referencePreviewKind,
    paramCount: summary.paramCount,
    paramKeys: Array.isArray(summary.paramKeys) ? summary.paramKeys : undefined,
    importedCount: summary.importedCount,
    renderedCount: summary.renderedCount,
    stabilityCyclesCompleted: summary.stabilityCyclesCompleted,
    stabilityMemoryTrendStatus: summary.stabilityMemoryTrendStatus,
    desktopImportImportedCount: summary.desktopImportImportedCount,
    desktopImportRawCount: summary.desktopImportRawCount,
    desktopImportJpgCount: summary.desktopImportJpgCount,
    batchCancelPassed: summary.batchCancelPassed,
    abortPassed: summary.abortPassed,
    activeObjectUrls: summary.activeObjectUrls,
    privacyPassed: summary.privacyPassed,
    message: safeMessage(diagnostic.message ?? result.summary)
  };
};

const reportEvidence = [
  ...latestReports("phase5-desktop").map((report) => summarizeReport(report.path)),
  ...latestReports("phase5-export").map((report) => summarizeReport(report.path)),
  ...latestReports("phase5-process").map((report) => summarizeReport(report.path)),
  ...latestReports("phase5-ai-live").map((report) => summarizeReport(report.path)),
  ...latestReports("phase5-ai-raw-live", 3).map((report) => summarizeReport(report.path))
];

const summarizeManualAcceptance = () => {
  if (!fs.existsSync(manualAcceptancePath)) {
    return {
      path: manualAcceptancePath,
      exists: false,
      completionStatus: "missing",
      itemCount: 0,
      counts: {}
    };
  }
  const raw = fs.readFileSync(manualAcceptancePath, "utf8");
  const parsed = JSON.parse(raw);
  const counts = {};
  for (const item of parsed.items ?? []) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }
  return {
    path: manualAcceptancePath,
    exists: true,
    completionStatus: parsed.completionStatus,
    itemCount: parsed.items?.length ?? 0,
    counts,
    pendingIds: (parsed.items ?? []).filter((item) => item.status === "pending").map((item) => item.id)
  };
};

const evidence = {
  generatedAt: new Date().toISOString(),
  workspace,
  artifacts: artifacts.map(artifactEvidence),
  diagnostics: reportEvidence,
  manualAcceptance: summarizeManualAcceptance(),
  privacy: {
    doesNotReadOpenAiJson: true,
    evidenceContainsSecretLookingContent: false,
    checkedPatterns: ["http(s) URL", "authorization header shape", "sk-* key shape", "image data URL"]
  },
  remainingManualValidation: [
    "Windows release exe manual file picker and drag/drop",
    "Windows MSI/NSIS double-click installer, shortcuts, reinstall and interactive uninstall",
    "Right-side AI buttons manual experience",
    "macOS app/dmg, Keychain and Finder drag/drop validation"
  ]
};

const evidenceText = JSON.stringify(evidence, null, 2);
evidence.privacy.evidenceContainsSecretLookingContent = sensitivePattern.test(evidenceText);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

const summary = {
  status:
    evidence.artifacts.every((artifact) => artifact.exists) &&
    evidence.diagnostics.length >= 5 &&
    evidence.manualAcceptance.exists &&
    !evidence.privacy.evidenceContainsSecretLookingContent
      ? "passed"
      : "failed",
  outputPath,
  artifactCount: evidence.artifacts.length,
  diagnosticCount: evidence.diagnostics.length,
  manualAcceptanceCompletionStatus: evidence.manualAcceptance.completionStatus,
  manualAcceptancePendingCount: evidence.manualAcceptance.counts.pending ?? 0,
  secretFindingCount: evidence.privacy.evidenceContainsSecretLookingContent ? 1 : 0
};

console.log(JSON.stringify(summary, null, 2));
if (summary.status !== "passed") process.exitCode = 1;
