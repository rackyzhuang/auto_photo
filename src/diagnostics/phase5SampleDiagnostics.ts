import { createDefaultEditParams } from "../services/editParams";
import { analyzeImage, calculateFileHash, createAutoEdit, importPhotoFile } from "../services/imageProcessing";
import { disposePreviewWorker, renderPreviewWithWorkerFallback } from "../services/previewWorkerClient";
import {
  isTauriRuntime,
  readDiagnosticSampleFiles,
  readDiagnosticSampleManifest,
  saveDiagnosticReport,
  type DiagnosticSampleFile
} from "../services/desktopBridge";
import type { CameraBrand, PhotoAsset, PreviewKind, SourceFormat } from "../types";
import type { EditParams } from "../types";

type ExpectationStatus = "passed" | "failed" | "missing" | "not-configured";
type AutoParamKey = keyof Omit<EditParams, "schemaVersion" | "hsl">;

interface NumericRange {
  min?: number;
  max?: number;
}

interface SampleManifestEntry {
  name: string;
  expectedBrand?: CameraBrand;
  expectedSourceFormat?: SourceFormat;
  requireModel?: boolean;
  requireIso?: boolean;
  requireLens?: boolean;
  shouldRender?: boolean;
  shouldAutoTune?: boolean;
  requireAutoEditChange?: boolean;
  autoParamRanges?: Partial<Record<AutoParamKey, NumericRange>>;
}

interface SampleManifest {
  samples: SampleManifestEntry[];
}

interface SampleExpectationResult {
  status: ExpectationStatus;
  checks: string[];
  failures: string[];
}

interface SampleDiagnosticItem {
  name: string;
  path?: string;
  size: number;
  sourceFormat?: SourceFormat;
  previewKind?: PreviewKind;
  cameraBrand?: CameraBrand;
  isEditable?: boolean;
  make?: string;
  model?: string;
  lens?: string;
  iso?: number;
  fNumber?: number;
  exposureTime?: string;
  rendered?: boolean;
  autoTuned?: boolean;
  autoEditChanged?: boolean;
  autoPreviewRendered?: boolean;
  autoSummary?: string[];
  autoParams?: Partial<Record<AutoParamKey, number>>;
  status: "passed" | "failed";
  detail: string;
  expectation?: SampleExpectationResult;
}

interface SampleDiagnosticReport {
  startedAt: string;
  finishedAt?: string;
  totalDurationMs?: number;
  savedReportPath?: string;
  sampleDir?: string;
  sampleManifestPath?: string;
  status: "running" | "passed" | "failed" | "skipped";
  summary: {
    totalFiles: number;
    imported: number;
    jpg: number;
    raw: number;
    editable: number;
    rendered: number;
    failed: number;
    sony: number;
    nikon: number;
    unknown: number;
    metadataWithModel: number;
    metadataWithLens: number;
    metadataWithIso: number;
    expectationPassed: number;
    expectationFailed: number;
    expectationMissing: number;
    expectationNotConfigured: number;
    autoTuned: number;
    autoTuneFailed: number;
    autoPreviewRendered: number;
  };
  items: SampleDiagnosticItem[];
  manifestExpectations?: SampleManifestEntry[];
  notes: string[];
}

declare global {
  interface Window {
    __AUTO_PHOTO_PHASE5_SAMPLE_DIAGNOSTICS__?: SampleDiagnosticReport;
  }
}

const sampleDir = import.meta.env.VITE_AUTO_PHOTO_SAMPLE_DIR;
const sampleManifestPath = import.meta.env.VITE_AUTO_PHOTO_SAMPLE_MANIFEST;
const maxRenderCount = Math.max(0, Number.parseInt(import.meta.env.VITE_AUTO_PHOTO_SAMPLE_RENDER_COUNT ?? "12", 10) || 12);
const maxAutoTuneCount = Math.max(0, Number.parseInt(import.meta.env.VITE_AUTO_PHOTO_SAMPLE_AUTO_TUNE_COUNT ?? "12", 10) || 12);

const now = () => performance.now();

const formatFileSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const base64ToFile = (sample: DiagnosticSampleFile) => {
  const binary = atob(sample.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], sample.name, { type: sample.mimeType, lastModified: 1_788_800_000_000 });
};

const createEmptySummary = (): SampleDiagnosticReport["summary"] => ({
  totalFiles: 0,
  imported: 0,
  jpg: 0,
  raw: 0,
  editable: 0,
  rendered: 0,
  failed: 0,
  sony: 0,
  nikon: 0,
  unknown: 0,
  metadataWithModel: 0,
  metadataWithLens: 0,
  metadataWithIso: 0,
  expectationPassed: 0,
  expectationFailed: 0,
  expectationMissing: 0,
  expectationNotConfigured: 0,
  autoTuned: 0,
  autoTuneFailed: 0,
  autoPreviewRendered: 0
});

const autoParamKeys: AutoParamKey[] = [
  "exposure",
  "temperature",
  "tint",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "saturation",
  "vibrance",
  "clarity",
  "texture",
  "dehaze",
  "vignette",
  "grain",
  "sharpness",
  "noiseReduction",
  "skinProtection"
];

const hasMeaningfulEditChange = (edits: EditParams) => {
  const defaults = createDefaultEditParams();
  return autoParamKeys.some((key) => Math.abs(Number(edits[key]) - Number(defaults[key])) >= 0.1);
};

const pickAutoParams = (edits: EditParams): Partial<Record<AutoParamKey, number>> => {
  const params: Partial<Record<AutoParamKey, number>> = {};
  for (const key of autoParamKeys) {
    params[key] = Number(edits[key]);
  }
  return params;
};

const parseAutoParamRanges = (entry: Partial<SampleManifestEntry>, sampleName: string) => {
  if (!entry.autoParamRanges) return undefined;
  if (typeof entry.autoParamRanges !== "object") {
    throw new Error(`Sample manifest entry ${sampleName} has invalid autoParamRanges.`);
  }

  const ranges: Partial<Record<AutoParamKey, NumericRange>> = {};
  const rawRanges = entry.autoParamRanges as Record<string, NumericRange>;
  for (const [key, range] of Object.entries(rawRanges)) {
    if (!autoParamKeys.includes(key as AutoParamKey)) {
      throw new Error(`Sample manifest entry ${sampleName} has unknown autoParamRanges key: ${key}.`);
    }
    if (!range || typeof range !== "object") {
      throw new Error(`Sample manifest entry ${sampleName} has invalid range for ${key}.`);
    }
    const min = range.min;
    const max = range.max;
    if (typeof min !== "undefined" && typeof min !== "number") {
      throw new Error(`Sample manifest entry ${sampleName} has non-numeric min for ${key}.`);
    }
    if (typeof max !== "undefined" && typeof max !== "number") {
      throw new Error(`Sample manifest entry ${sampleName} has non-numeric max for ${key}.`);
    }
    if (typeof min === "number" && typeof max === "number" && min > max) {
      throw new Error(`Sample manifest entry ${sampleName} has min greater than max for ${key}.`);
    }
    ranges[key as AutoParamKey] = { min, max };
  }

  return ranges;
};

const releaseAssets = (assets: PhotoAsset[]) => {
  for (const asset of assets) {
    if (asset.objectUrl.startsWith("blob:")) URL.revokeObjectURL(asset.objectUrl);
  }
  disposePreviewWorker();
};

const parseSampleManifest = (manifestText: string): SampleManifest => {
  const parsed = JSON.parse(manifestText.replace(/^\uFEFF/, "")) as Partial<SampleManifest>;
  if (!Array.isArray(parsed.samples)) {
    throw new Error("Sample manifest must contain a samples array.");
  }

  const samples = parsed.samples.map((entry, index) => {
    if (!entry || typeof entry.name !== "string" || entry.name.trim().length === 0) {
      throw new Error(`Sample manifest entry ${index + 1} must include a name.`);
    }
    if (entry.expectedBrand && !["Sony", "Nikon", "Unknown"].includes(entry.expectedBrand)) {
      throw new Error(`Sample manifest entry ${entry.name} has invalid expectedBrand.`);
    }
    if (entry.expectedSourceFormat && !["jpg", "raw"].includes(entry.expectedSourceFormat)) {
      throw new Error(`Sample manifest entry ${entry.name} has invalid expectedSourceFormat.`);
    }

    return {
      name: entry.name,
      expectedBrand: entry.expectedBrand,
      expectedSourceFormat: entry.expectedSourceFormat,
      requireModel: entry.requireModel === true,
      requireIso: entry.requireIso === true,
      requireLens: entry.requireLens === true,
      shouldRender: typeof entry.shouldRender === "boolean" ? entry.shouldRender : undefined,
      shouldAutoTune: typeof entry.shouldAutoTune === "boolean" ? entry.shouldAutoTune : undefined,
      requireAutoEditChange: entry.requireAutoEditChange === true,
      autoParamRanges: parseAutoParamRanges(entry, entry.name)
    };
  });

  return { samples };
};

const evaluateExpectation = (item: SampleDiagnosticItem, expectation?: SampleManifestEntry): SampleExpectationResult => {
  if (!expectation) {
    return {
      status: "not-configured",
      checks: [],
      failures: []
    };
  }

  const checks: string[] = [];
  const failures: string[] = [];
  const addCheck = (passed: boolean, message: string) => {
    checks.push(message);
    if (!passed) failures.push(message);
  };

  if (expectation.expectedBrand) {
    addCheck(item.cameraBrand === expectation.expectedBrand, `expectedBrand=${expectation.expectedBrand}`);
  }
  if (expectation.expectedSourceFormat) {
    addCheck(item.sourceFormat === expectation.expectedSourceFormat, `expectedSourceFormat=${expectation.expectedSourceFormat}`);
  }
  if (expectation.requireModel) {
    addCheck(Boolean(item.model), "requireModel");
  }
  if (expectation.requireIso) {
    addCheck(typeof item.iso === "number", "requireIso");
  }
  if (expectation.requireLens) {
    addCheck(Boolean(item.lens), "requireLens");
  }
  if (typeof expectation.shouldRender === "boolean") {
    addCheck(Boolean(item.rendered) === expectation.shouldRender, `shouldRender=${expectation.shouldRender}`);
  }
  if (typeof expectation.shouldAutoTune === "boolean") {
    addCheck(Boolean(item.autoTuned) === expectation.shouldAutoTune, `shouldAutoTune=${expectation.shouldAutoTune}`);
  }
  if (expectation.requireAutoEditChange) {
    addCheck(Boolean(item.autoEditChanged), "requireAutoEditChange");
  }
  if (expectation.autoParamRanges) {
    for (const [key, range] of Object.entries(expectation.autoParamRanges) as Array<[AutoParamKey, NumericRange]>) {
      const value = item.autoParams?.[key];
      const hasValue = typeof value === "number" && Number.isFinite(value);
      const aboveMin = typeof range.min !== "number" || (hasValue && value >= range.min);
      const belowMax = typeof range.max !== "number" || (hasValue && value <= range.max);
      const passed = hasValue && aboveMin && belowMax;
      const label = `autoParam.${key}${typeof range.min === "number" ? `>=${range.min}` : ""}${typeof range.max === "number" ? `<=${range.max}` : ""}`;
      addCheck(passed, label);
    }
  }

  return {
    status: failures.length > 0 ? "failed" : "passed",
    checks,
    failures
  };
};

const applyManifestExpectations = (report: SampleDiagnosticReport, manifest?: SampleManifest) => {
  report.summary.expectationPassed = 0;
  report.summary.expectationFailed = 0;
  report.summary.expectationMissing = 0;
  report.summary.expectationNotConfigured = 0;

  if (!manifest) {
    for (const item of report.items) {
      item.expectation = evaluateExpectation(item);
      report.summary.expectationNotConfigured += 1;
    }
    return;
  }

  const expectationsByName = new Map(manifest.samples.map((sample) => [sample.name.toLowerCase(), sample]));
  const seen = new Set<string>();

  for (const item of report.items) {
    const expectation = expectationsByName.get(item.name.toLowerCase());
    if (expectation) seen.add(expectation.name.toLowerCase());
    item.expectation = evaluateExpectation(item, expectation);
    if (item.expectation.status === "passed") report.summary.expectationPassed += 1;
    else if (item.expectation.status === "failed") report.summary.expectationFailed += 1;
    else report.summary.expectationNotConfigured += 1;
  }

  for (const expectation of manifest.samples) {
    if (seen.has(expectation.name.toLowerCase())) continue;
    report.summary.expectationMissing += 1;
    report.summary.failed += 1;
    report.items.push({
      name: expectation.name,
      size: 0,
      status: "failed",
      detail: "Expected sample missing from directory",
      expectation: {
        status: "missing",
        checks: [],
        failures: ["missing sample"]
      }
    });
  }
};

const filterSamplesByManifest = (samples: DiagnosticSampleFile[], manifest?: SampleManifest) => {
  if (!manifest) return samples;
  const expectedNames = new Set(manifest.samples.map((sample) => sample.name.toLowerCase()));
  return samples.filter((sample) => expectedNames.has(sample.name.toLowerCase()));
};

const makeRoot = () => {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");
  root.innerHTML = "";
  root.style.fontFamily = 'Inter, "Segoe UI", sans-serif';
  root.style.padding = "24px";
  root.style.color = "#17202a";
  root.style.background = "#f6f7f9";
  root.style.minHeight = "100vh";
  return root;
};

const detectSampleMetadataBrand = (make?: string, model?: string): CameraBrand => {
  const text = `${make ?? ""} ${model ?? ""}`.toLowerCase();
  if (text.includes("sony")) return "Sony";
  if (text.includes("nikon")) return "Nikon";
  return "Unknown";
};

const applyDiagnosticSampleMetadata = (asset: PhotoAsset, sample: DiagnosticSampleFile) => {
  if (asset.sourceFormat !== "raw" || !sample.metadata) return;
  asset.metadata = {
    ...asset.metadata,
    ...sample.metadata,
    make: sample.metadata.make ?? asset.metadata.make,
    model: sample.metadata.model ?? asset.metadata.model,
    lens: sample.metadata.lens ?? asset.metadata.lens
  };
  const metadataBrand = detectSampleMetadataBrand(asset.metadata.make, asset.metadata.model);
  if (metadataBrand !== "Unknown") asset.cameraBrand = metadataBrand;
};

const renderReport = (root: HTMLElement, report: SampleDiagnosticReport) => {
  const rows = report.items
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.sourceFormat ?? "")}</td><td>${escapeHtml(item.previewKind ?? "")}</td><td>${escapeHtml(item.cameraBrand ?? "")}</td><td>${escapeHtml(formatFileSize(item.size))}</td><td>${escapeHtml(item.model ?? "")}</td><td>${escapeHtml(item.lens ?? "")}</td><td>${escapeHtml(item.iso ?? "")}</td><td>${item.rendered ? "yes" : ""}</td><td>${item.autoTuned ? "yes" : ""}</td><td>${item.autoEditChanged ? "yes" : ""}</td><td>${escapeHtml(item.autoParams ? `exp ${item.autoParams.exposure}, temp ${item.autoParams.temperature}, skin ${item.autoParams.skinProtection}` : "")}</td><td>${escapeHtml(item.expectation?.status ?? "")}</td><td>${escapeHtml(item.expectation?.failures.join("; ") ?? "")}</td><td>${escapeHtml(item.detail)}</td></tr>`
    )
    .join("");
  root.innerHTML = `
    <main style="max-width: 1120px; margin: 0 auto;">
      <h1 style="margin: 0 0 8px; font-size: 26px;">Phase 5 Sample Diagnostics</h1>
      <p style="margin: 0 0 10px; color: #53616f;">Status: <strong>${report.status}</strong></p>
      <p style="margin: 0 0 10px; color: #53616f; word-break: break-all;">Sample dir: ${escapeHtml(report.sampleDir ?? "not configured")}</p>
      <p style="margin: 0 0 10px; color: #53616f; word-break: break-all;">Manifest: ${escapeHtml(report.sampleManifestPath ?? "not configured")}</p>
      ${report.savedReportPath ? `<p style="margin: 0 0 10px; color: #53616f; word-break: break-all;">Saved report: ${escapeHtml(report.savedReportPath)}</p>` : ""}
      <section style="display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 10px; margin: 16px 0;">
        <div style="background:white; padding: 12px; border:1px solid #dfe4ea;">Files<br><strong>${report.summary.totalFiles}</strong></div>
        <div style="background:white; padding: 12px; border:1px solid #dfe4ea;">Imported<br><strong>${report.summary.imported}</strong></div>
        <div style="background:white; padding: 12px; border:1px solid #dfe4ea;">JPG / RAW<br><strong>${report.summary.jpg} / ${report.summary.raw}</strong></div>
        <div style="background:white; padding: 12px; border:1px solid #dfe4ea;">Rendered<br><strong>${report.summary.rendered}</strong></div>
        <div style="background:white; padding: 12px; border:1px solid #dfe4ea;">Auto Tuned<br><strong>${report.summary.autoTuned}</strong></div>
        <div style="background:white; padding: 12px; border:1px solid #dfe4ea;">Auto Preview<br><strong>${report.summary.autoPreviewRendered}</strong></div>
        <div style="background:white; padding: 12px; border:1px solid #dfe4ea;">Sony / Nikon<br><strong>${report.summary.sony} / ${report.summary.nikon}</strong></div>
        <div style="background:white; padding: 12px; border:1px solid #dfe4ea;">Failed<br><strong>${report.summary.failed}</strong></div>
        <div style="background:white; padding: 12px; border:1px solid #dfe4ea;">Expected OK<br><strong>${report.summary.expectationPassed}</strong></div>
        <div style="background:white; padding: 12px; border:1px solid #dfe4ea;">Expected Fail<br><strong>${report.summary.expectationFailed}</strong></div>
      </section>
      <ul style="margin: 0 0 16px; color: #53616f;">${report.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
      <table style="width:100%; border-collapse: collapse; background:white; border:1px solid #dfe4ea;">
        <thead><tr><th>Status</th><th>Name</th><th>Format</th><th>Preview</th><th>Brand</th><th>Size</th><th>Model</th><th>Lens</th><th>ISO</th><th>Rendered</th><th>Auto</th><th>Changed</th><th>Auto Params</th><th>Expected</th><th>Expected Failures</th><th>Detail</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </main>
  `;
  root.querySelectorAll("th,td").forEach((cell) => {
    const element = cell as HTMLElement;
    element.style.textAlign = "left";
    element.style.borderBottom = "1px solid #edf0f3";
    element.style.padding = "9px 10px";
    element.style.fontSize = "12px";
    element.style.verticalAlign = "top";
  });
};

const summarizeAsset = (asset: PhotoAsset, sample: DiagnosticSampleFile): SampleDiagnosticItem => ({
  name: asset.name,
  path: sample.path,
  size: sample.size,
  sourceFormat: asset.sourceFormat,
  previewKind: asset.previewKind,
  cameraBrand: asset.cameraBrand,
  isEditable: asset.isEditable,
  make: asset.metadata.make,
  model: asset.metadata.model,
  lens: asset.metadata.lens,
  iso: asset.metadata.iso,
  fNumber: asset.metadata.fNumber,
  exposureTime: asset.metadata.exposureTime,
  status: "passed",
  detail: asset.isEditable
    ? "Imported editable JPG"
    : sample.dataBase64
      ? "Imported RAW placeholder"
      : "Imported RAW placeholder from file metadata"
});

export const runPhase5SampleDiagnostics = async () => {
  const root = makeRoot();
  const started = now();
  const report: SampleDiagnosticReport = {
    startedAt: new Date().toISOString(),
    sampleDir,
    sampleManifestPath,
    status: "running",
    summary: createEmptySummary(),
    items: [],
    notes: [
      "This diagnostics reads only the configured local sample directory.",
      "Original sample files are not modified.",
      "AI is not used and openAi.json is not read."
    ]
  };
  window.__AUTO_PHOTO_PHASE5_SAMPLE_DIAGNOSTICS__ = report;
  renderReport(root, report);

  const assets: PhotoAsset[] = [];
  try {
    if (!isTauriRuntime()) {
      report.status = "skipped";
      report.notes.push("Skipped because this diagnostics requires Tauri runtime.");
      return report;
    }
    if (!sampleDir?.trim()) {
      report.status = "skipped";
      report.notes.push("Set VITE_AUTO_PHOTO_SAMPLE_DIR to a local folder containing Sony/Nikon JPG, ARW or NEF files.");
      return report;
    }

    let manifest: SampleManifest | undefined;
    if (sampleManifestPath?.trim()) {
      const manifestText = await readDiagnosticSampleManifest(sampleManifestPath);
      if (!manifestText) throw new Error("Sample manifest could not be read.");
      manifest = parseSampleManifest(manifestText);
      report.manifestExpectations = manifest.samples;
      report.notes.push(`Loaded sample manifest with ${manifest.samples.length} expectations.`);
    }

    const discoveredSamples = await readDiagnosticSampleFiles(sampleDir);
    const samples = filterSamplesByManifest(discoveredSamples, manifest);
    if (manifest && samples.length !== discoveredSamples.length) {
      report.notes.push(`Ignored ${discoveredSamples.length - samples.length} sample file(s) not listed in the manifest.`);
    }
    report.summary.totalFiles = samples.length;
    if (samples.length === 0) {
      report.status = "skipped";
      report.notes.push("No supported sample files were found. Supported extensions: .jpg, .jpeg, .arw, .nef.");
      return report;
    }

    for (const sample of samples) {
      try {
        const file = base64ToFile(sample);
        const asset = await importPhotoFile(file, await calculateFileHash(file));
        applyDiagnosticSampleMetadata(asset, sample);
        assets.push(asset);
        const item = summarizeAsset(asset, sample);
        report.items.push(item);
        report.summary.imported += 1;
        if (asset.sourceFormat === "jpg") report.summary.jpg += 1;
        if (asset.sourceFormat === "raw") report.summary.raw += 1;
        if (asset.isEditable) report.summary.editable += 1;
        if (asset.cameraBrand === "Sony") report.summary.sony += 1;
        else if (asset.cameraBrand === "Nikon") report.summary.nikon += 1;
        else report.summary.unknown += 1;
        if (asset.metadata.model) report.summary.metadataWithModel += 1;
        if (asset.metadata.lens) report.summary.metadataWithLens += 1;
        if (asset.metadata.iso) report.summary.metadataWithIso += 1;
      } catch (error) {
        report.summary.failed += 1;
        report.items.push({
          name: sample.name,
          path: sample.path,
          size: sample.size,
          status: "failed",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      renderReport(root, report);
    }

    let rendered = 0;
    for (const asset of assets.filter((item) => item.isEditable).slice(0, maxRenderCount)) {
      const dataUrl = await renderPreviewWithWorkerFallback(asset, createDefaultEditParams(), { maxEdge: 900, quality: 0.84 });
      if (!dataUrl.startsWith("data:image/jpeg")) throw new Error(`Sample render failed for ${asset.name}`);
      rendered += 1;
      const item = report.items.find((entry) => entry.name === asset.name && entry.status === "passed");
      if (item) {
        item.rendered = true;
        item.detail = "Imported and rendered JPG";
      }
      report.summary.rendered = rendered;
      renderReport(root, report);
    }

    let autoTuned = 0;
    let autoPreviewRendered = 0;
    for (const asset of assets.filter((item) => item.isEditable).slice(0, maxAutoTuneCount)) {
      const item = report.items.find((entry) => entry.name === asset.name && entry.status === "passed");
      try {
        const analysis = await analyzeImage(asset);
        const auto = createAutoEdit(asset, analysis);
        const autoPreview = await renderPreviewWithWorkerFallback(asset, auto.edits, { maxEdge: 900, quality: 0.84 });
        if (!autoPreview.startsWith("data:image/jpeg")) throw new Error(`Auto preview render failed for ${asset.name}`);

        autoTuned += 1;
        autoPreviewRendered += 1;
        if (item) {
          item.autoTuned = true;
          item.autoEditChanged = hasMeaningfulEditChange(auto.edits);
          item.autoPreviewRendered = true;
          item.autoSummary = auto.summary;
          item.autoParams = pickAutoParams(auto.edits);
          item.detail = `${item.detail}; auto tuned`;
        }
        report.summary.autoTuned = autoTuned;
        report.summary.autoPreviewRendered = autoPreviewRendered;
      } catch (error) {
        report.summary.autoTuneFailed += 1;
        report.summary.failed += 1;
        if (item) {
          item.status = "failed";
          item.detail = `Auto tune failed: ${error instanceof Error ? error.message : String(error)}`;
        } else {
          report.items.push({
            name: asset.name,
            size: asset.size,
            sourceFormat: asset.sourceFormat,
            cameraBrand: asset.cameraBrand,
            status: "failed",
            detail: `Auto tune failed: ${error instanceof Error ? error.message : String(error)}`
          });
        }
      }
      renderReport(root, report);
    }

    applyManifestExpectations(report, manifest);
    report.status =
      report.summary.failed > 0 || report.summary.expectationFailed > 0 || report.summary.expectationMissing > 0
        ? "failed"
        : "passed";
  } catch (error) {
    report.status = "failed";
    report.notes.push(error instanceof Error ? error.message : String(error));
  } finally {
    releaseAssets(assets);
    report.finishedAt = new Date().toISOString();
    report.totalDurationMs = now() - started;
    if (isTauriRuntime() && report.status !== "skipped") {
      try {
        const savedPath = await saveDiagnosticReport("phase5-samples", report);
        if (savedPath) report.savedReportPath = savedPath;
      } catch (error) {
        report.status = "failed";
        report.notes.push(error instanceof Error ? error.message : String(error));
      }
    }
    renderReport(root, report);
  }

  return report;
};
