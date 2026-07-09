import { analyzeImage, createAutoEdit, importPhotoFile } from "../services/imageProcessing";
import { disposePreviewWorker, renderPreviewWithWorkerFallback } from "../services/previewWorkerClient";
import type { CameraBrand, PhotoAsset, SourceFormat } from "../types";

interface GeneratedJpgManifestSample {
  name: string;
  brand: CameraBrand;
  status: string;
  output: string;
  width: number;
  height: number;
  expectedBrand: CameraBrand;
  make?: string;
  model?: string;
  lens?: string;
  iso?: number;
  requireModel?: boolean;
  requireLens?: boolean;
  requireIso?: boolean;
  expectedSourceFormat?: SourceFormat;
  shouldRender?: boolean;
  shouldAutoTune?: boolean;
  requireAutoEditChange?: boolean;
}

interface GeneratedJpgManifest {
  generatedAt: string;
  source: string;
  samples: GeneratedJpgManifestSample[];
}

interface GeneratedJpgDiagnosticItem {
  name: string;
  status: "passed" | "failed";
  detail: string;
  durationMs: number;
  sourceFormat?: SourceFormat;
  cameraBrand?: CameraBrand;
  isEditable?: boolean;
  model?: string;
  lens?: string;
  iso?: number;
  previewWidth?: number;
  previewHeight?: number;
  renderedWidth?: number;
  renderedHeight?: number;
  autoExposure?: number;
  autoTemperature?: number;
  autoTint?: number;
  autoSummary?: string;
  previewUrl?: string;
  renderedUrl?: string;
}

interface GeneratedJpgDiagnosticReport {
  startedAt: string;
  finishedAt?: string;
  totalDurationMs?: number;
  status: "running" | "passed" | "failed";
  manifest?: {
    generatedAt: string;
    source: string;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    editable: number;
    rendered: number;
    autoTuned: number;
    sony: number;
    nikon: number;
  };
  items: GeneratedJpgDiagnosticItem[];
  notes: string[];
}

declare global {
  interface Window {
    __AUTO_PHOTO_PHASE5_GENERATED_JPG_DIAGNOSTICS__?: GeneratedJpgDiagnosticReport;
  }
}

const MANIFEST_URL = "/image/generated-jpg/sample-manifest.json";

const now = () => performance.now();

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeStaticPath = (path: string) => `/${path.replace(/\\/g, "/").replace(/^\/+/, "")}`;

const loadImageSize = (url: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Image failed to decode"));
    image.src = url;
  });

const makeRoot = () => {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");
  root.innerHTML = "";
  root.style.fontFamily = 'Inter, "Segoe UI", Arial, sans-serif';
  root.style.padding = "24px";
  root.style.color = "#17202a";
  root.style.background = "#f6f7f9";
  root.style.minHeight = "100vh";
  return root;
};

const createEmptyReport = (): GeneratedJpgDiagnosticReport => ({
  startedAt: new Date().toISOString(),
  status: "running",
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    editable: 0,
    rendered: 0,
    autoTuned: 0,
    sony: 0,
    nikon: 0
  },
  items: [],
  notes: [
    "This diagnostics imports generated Sony/Nikon JPG fixtures through the normal browser import path.",
    "It verifies EXIF-derived camera metadata, editable JPG state, auto color generation, and preview rendering.",
    "AI is not used and openAi.json is not read."
  ]
});

const renderReport = (root: HTMLElement, report: GeneratedJpgDiagnosticReport) => {
  root.dataset.phase5GeneratedJpgStatus = report.status;
  root.dataset.phase5GeneratedJpgPassed = String(report.summary.passed);
  root.dataset.phase5GeneratedJpgFailed = String(report.summary.failed);
  root.dataset.phase5GeneratedJpgRendered = String(report.summary.rendered);
  root.dataset.phase5GeneratedJpgAutoTuned = String(report.summary.autoTuned);
  const rows = report.items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.status)}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.sourceFormat)}</td>
          <td>${escapeHtml(item.cameraBrand)}</td>
          <td>${escapeHtml(item.model)}</td>
          <td>${escapeHtml(item.lens)}</td>
          <td>${escapeHtml(item.iso)}</td>
          <td>${escapeHtml(item.previewWidth && item.previewHeight ? `${item.previewWidth}x${item.previewHeight}` : "")}</td>
          <td>${escapeHtml(item.renderedWidth && item.renderedHeight ? `${item.renderedWidth}x${item.renderedHeight}` : "")}</td>
          <td>${escapeHtml(item.autoExposure)}</td>
          <td>${escapeHtml(item.autoTemperature)}</td>
          <td>${escapeHtml(item.autoTint)}</td>
          <td>${Math.round(item.durationMs)} ms</td>
          <td>${item.previewUrl ? `<img src="${item.previewUrl}" style="width:128px;max-height:92px;object-fit:contain;border:1px solid #d8dee5;background:#111820" />` : ""}</td>
          <td>${item.renderedUrl ? `<img src="${item.renderedUrl}" style="width:128px;max-height:92px;object-fit:contain;border:1px solid #d8dee5;background:#111820" />` : ""}</td>
          <td>${escapeHtml(item.detail)}</td>
        </tr>`
    )
    .join("");

  root.innerHTML = `
    <main style="max-width:1280px;margin:0 auto">
      <h1 style="margin:0 0 8px;font-size:26px">Phase 5 Generated JPG Diagnostics</h1>
      <p style="margin:0 0 10px;color:#53616f">Status: <strong>${report.status}</strong></p>
      ${
        report.manifest
          ? `<p style="margin:0 0 10px;color:#53616f">Manifest: ${escapeHtml(report.manifest.generatedAt)} / ${escapeHtml(report.manifest.source)}</p>`
          : ""
      }
      <section style="display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:10px;margin:16px 0">
        <div style="background:white;padding:12px;border:1px solid #dfe4ea">Total<br><strong>${report.summary.total}</strong></div>
        <div style="background:white;padding:12px;border:1px solid #dfe4ea">Passed<br><strong>${report.summary.passed}</strong></div>
        <div style="background:white;padding:12px;border:1px solid #dfe4ea">Failed<br><strong>${report.summary.failed}</strong></div>
        <div style="background:white;padding:12px;border:1px solid #dfe4ea">Editable<br><strong>${report.summary.editable}</strong></div>
        <div style="background:white;padding:12px;border:1px solid #dfe4ea">Rendered<br><strong>${report.summary.rendered}</strong></div>
        <div style="background:white;padding:12px;border:1px solid #dfe4ea">Auto Tuned<br><strong>${report.summary.autoTuned}</strong></div>
        <div style="background:white;padding:12px;border:1px solid #dfe4ea">Sony<br><strong>${report.summary.sony}</strong></div>
        <div style="background:white;padding:12px;border:1px solid #dfe4ea">Nikon<br><strong>${report.summary.nikon}</strong></div>
      </section>
      <ul style="margin:0 0 16px;color:#53616f">${report.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
      <table style="width:100%;border-collapse:collapse;background:white;border:1px solid #dfe4ea">
        <thead><tr><th>Status</th><th>Name</th><th>Format</th><th>Brand</th><th>Model</th><th>Lens</th><th>ISO</th><th>Preview</th><th>Rendered</th><th>Exposure</th><th>Temp</th><th>Tint</th><th>Time</th><th>Thumb</th><th>Auto</th><th>Detail</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </main>
  `;
  root.querySelectorAll("th,td").forEach((cell) => {
    const element = cell as HTMLElement;
    element.style.textAlign = "left";
    element.style.borderBottom = "1px solid #edf0f3";
    element.style.padding = "8px 9px";
    element.style.fontSize = "12px";
    element.style.verticalAlign = "top";
    element.style.wordBreak = "break-word";
  });
};

const hasMeaningfulAutoEdit = (asset: PhotoAsset, requireChange?: boolean) => {
  if (!requireChange) return true;
  const edits = asset.edits;
  return (
    Math.abs(edits.exposure) > 0.01 ||
    Math.abs(edits.temperature) > 0.01 ||
    Math.abs(edits.tint) > 0.01 ||
    Math.abs(edits.contrast) > 0.01 ||
    Math.abs(edits.vibrance) > 0.01 ||
    Math.abs(edits.clarity) > 0.01 ||
    Math.abs(edits.sharpness) > 0.01
  );
};

const validateAsset = (
  sample: GeneratedJpgManifestSample,
  asset: PhotoAsset,
  previewSize: { width: number; height: number },
  renderedSize?: { width: number; height: number }
) => {
  const failures: string[] = [];
  if (asset.sourceFormat !== (sample.expectedSourceFormat ?? "jpg")) {
    failures.push(`expected sourceFormat ${sample.expectedSourceFormat ?? "jpg"}, got ${asset.sourceFormat}`);
  }
  if (!asset.isEditable) failures.push("JPG fixture must be editable");
  if (asset.previewKind !== "jpg") failures.push(`expected previewKind jpg, got ${asset.previewKind}`);
  if (asset.cameraBrand !== sample.expectedBrand) failures.push(`expected brand ${sample.expectedBrand}, got ${asset.cameraBrand}`);
  if (sample.make && asset.metadata.make !== sample.make) failures.push(`expected make ${sample.make}, got ${asset.metadata.make ?? "n/a"}`);
  if (sample.requireModel && !asset.metadata.model) failures.push("expected EXIF model");
  if (sample.model && asset.metadata.model !== sample.model) {
    failures.push(`expected model ${sample.model}, got ${asset.metadata.model ?? "n/a"}`);
  }
  if (sample.requireLens && !asset.metadata.lens) failures.push("expected EXIF lens");
  if (sample.lens && asset.metadata.lens !== sample.lens) {
    failures.push(`expected lens ${sample.lens}, got ${asset.metadata.lens ?? "n/a"}`);
  }
  if (sample.requireIso && typeof asset.metadata.iso !== "number") failures.push("expected EXIF ISO");
  if (typeof sample.iso === "number" && asset.metadata.iso !== sample.iso) {
    failures.push(`expected ISO ${sample.iso}, got ${asset.metadata.iso ?? "n/a"}`);
  }
  if (previewSize.width < 240 || previewSize.height < 160) {
    failures.push(`preview is too small: ${previewSize.width}x${previewSize.height}`);
  }
  if (sample.shouldRender && (!renderedSize || renderedSize.width < 320 || renderedSize.height < 200)) {
    failures.push(`rendered preview is too small: ${renderedSize ? `${renderedSize.width}x${renderedSize.height}` : "n/a"}`);
  }
  if (!hasMeaningfulAutoEdit(asset, sample.requireAutoEditChange)) failures.push("auto edit did not change key parameters");
  return failures;
};

const fetchManifest = async () => {
  const response = await fetch(MANIFEST_URL);
  if (!response.ok) throw new Error(`Manifest fetch failed: ${response.status} ${response.statusText}`);
  return (await response.json()) as GeneratedJpgManifest;
};

const importSample = async (sample: GeneratedJpgManifestSample): Promise<GeneratedJpgDiagnosticItem> => {
  const started = now();
  let asset: PhotoAsset | undefined;
  try {
    const sampleUrl = normalizeStaticPath(sample.output);
    const response = await fetch(sampleUrl);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    const blob = await response.blob();
    const file = new File([blob], sample.name, { type: "image/jpeg", lastModified: 1_788_800_000_000 });
    asset = await importPhotoFile(file, `phase5-generated-jpg-${sample.name}`);

    if (sample.shouldAutoTune) {
      const analysis = await analyzeImage(asset);
      const auto = createAutoEdit(asset, analysis);
      asset.edits = auto.edits;
      asset.autoSummary = auto.summary;
    }

    const previewSize = await loadImageSize(asset.previewUrl);
    let renderedUrl: string | undefined;
    let renderedSize: { width: number; height: number } | undefined;
    if (sample.shouldRender) {
      renderedUrl = await renderPreviewWithWorkerFallback(asset, asset.edits, { maxEdge: 900, quality: 0.84 });
      if (!renderedUrl.startsWith("data:image/jpeg")) throw new Error("Rendered preview did not return JPG data URL");
      renderedSize = await loadImageSize(renderedUrl);
    }

    const failures = validateAsset(sample, asset, previewSize, renderedSize);
    return {
      name: sample.name,
      status: failures.length > 0 ? "failed" : "passed",
      detail: failures.length > 0 ? failures.join("; ") : "Generated JPG imported, auto tuned, and rendered",
      durationMs: now() - started,
      sourceFormat: asset.sourceFormat,
      cameraBrand: asset.cameraBrand,
      isEditable: asset.isEditable,
      model: asset.metadata.model,
      lens: asset.metadata.lens,
      iso: asset.metadata.iso,
      previewWidth: previewSize.width,
      previewHeight: previewSize.height,
      renderedWidth: renderedSize?.width,
      renderedHeight: renderedSize?.height,
      autoExposure: Math.round(asset.edits.exposure * 10) / 10,
      autoTemperature: Math.round(asset.edits.temperature * 10) / 10,
      autoTint: Math.round(asset.edits.tint * 10) / 10,
      autoSummary: asset.autoSummary?.join("; "),
      previewUrl: asset.previewUrl,
      renderedUrl
    };
  } catch (error) {
    return {
      name: sample.name,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
      durationMs: now() - started
    };
  } finally {
    if (asset?.objectUrl.startsWith("blob:")) URL.revokeObjectURL(asset.objectUrl);
  }
};

const addItemToSummary = (report: GeneratedJpgDiagnosticReport, item: GeneratedJpgDiagnosticItem) => {
  if (item.status === "passed") report.summary.passed += 1;
  else report.summary.failed += 1;
  if (item.isEditable) report.summary.editable += 1;
  if (item.renderedWidth && item.renderedHeight) report.summary.rendered += 1;
  if (typeof item.autoExposure === "number") report.summary.autoTuned += 1;
  if (item.cameraBrand === "Sony") report.summary.sony += 1;
  if (item.cameraBrand === "Nikon") report.summary.nikon += 1;
};

export const runPhase5GeneratedJpgDiagnostics = async () => {
  const root = makeRoot();
  const report = createEmptyReport();
  const started = now();
  window.__AUTO_PHOTO_PHASE5_GENERATED_JPG_DIAGNOSTICS__ = report;
  renderReport(root, report);

  try {
    const manifest = await fetchManifest();
    report.manifest = {
      generatedAt: manifest.generatedAt,
      source: manifest.source
    };
    const samples = manifest.samples.filter((sample) => sample.status === "passed");
    report.summary.total = samples.length;
    renderReport(root, report);

    for (const sample of samples) {
      const item = await importSample(sample);
      report.items.push(item);
      addItemToSummary(report, item);
      renderReport(root, report);
    }

    report.status = report.summary.failed > 0 ? "failed" : "passed";
  } catch (error) {
    report.status = "failed";
    report.items.push({
      name: "manifest",
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
      durationMs: now() - started
    });
    report.summary.failed += 1;
  } finally {
    disposePreviewWorker();
    report.finishedAt = new Date().toISOString();
    report.totalDurationMs = now() - started;
    renderReport(root, report);
  }

  return report;
};
