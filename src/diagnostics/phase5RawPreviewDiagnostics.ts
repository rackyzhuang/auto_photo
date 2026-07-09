import { importPhotoFile } from "../services/imageProcessing";
import type { CameraBrand, PhotoAsset, PreviewKind } from "../types";

interface RawPreviewSample {
  name: string;
  url: string;
  type: string;
  expectedBrand: CameraBrand;
  expectedPreviewKind: PreviewKind;
}

interface RawPreviewDiagnosticItem {
  name: string;
  status: "passed" | "failed";
  detail: string;
  durationMs: number;
  sourceFormat?: string;
  previewKind?: PreviewKind;
  cameraBrand?: CameraBrand;
  isEditable?: boolean;
  model?: string;
  lens?: string;
  iso?: number;
  previewWidth?: number;
  previewHeight?: number;
  previewUrl?: string;
  previewBytes?: number;
}

interface RawPreviewDiagnosticReport {
  startedAt: string;
  finishedAt?: string;
  totalDurationMs?: number;
  status: "running" | "passed" | "failed";
  summary: {
    total: number;
    passed: number;
    failed: number;
    embeddedPreview: number;
    placeholderPreview: number;
    sony: number;
    nikon: number;
  };
  items: RawPreviewDiagnosticItem[];
  notes: string[];
}

declare global {
  interface Window {
    __AUTO_PHOTO_PHASE5_RAW_PREVIEW_DIAGNOSTICS__?: RawPreviewDiagnosticReport;
  }
}

const samples: RawPreviewSample[] = [
  {
    name: "DSC_2156.NEF",
    url: "/image/nikon/DSC_2156.NEF",
    type: "image/x-nikon-nef",
    expectedBrand: "Nikon",
    expectedPreviewKind: "raw_embedded"
  },
  {
    name: "20230813-0192.ARW",
    url: "/image/sony/20230813-0192.ARW",
    type: "image/x-sony-arw",
    expectedBrand: "Sony",
    expectedPreviewKind: "raw_embedded"
  }
];

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

const loadImageSize = (url: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Preview image failed to decode"));
    image.src = url;
  });

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

const createEmptyReport = (): RawPreviewDiagnosticReport => ({
  startedAt: new Date().toISOString(),
  status: "running",
  summary: {
    total: samples.length,
    passed: 0,
    failed: 0,
    embeddedPreview: 0,
    placeholderPreview: 0,
    sony: 0,
    nikon: 0
  },
  items: [],
  notes: [
    "This diagnostics fetches local RAW samples through the Vite dev server.",
    "It calls the normal importPhotoFile path, including RAW embedded preview extraction.",
    "AI is not used and openAi.json is not read."
  ]
});

const renderReport = (root: HTMLElement, report: RawPreviewDiagnosticReport) => {
  const rows = report.items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.status)}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.sourceFormat)}</td>
          <td>${escapeHtml(item.previewKind)}</td>
          <td>${escapeHtml(item.cameraBrand)}</td>
          <td>${escapeHtml(item.model)}</td>
          <td>${escapeHtml(item.lens)}</td>
          <td>${escapeHtml(item.iso)}</td>
          <td>${escapeHtml(item.previewWidth && item.previewHeight ? `${item.previewWidth}x${item.previewHeight}` : "")}</td>
          <td>${escapeHtml(item.previewBytes ? formatFileSize(item.previewBytes) : "")}</td>
          <td>${Math.round(item.durationMs)} ms</td>
          <td>${item.previewUrl ? `<img src="${item.previewUrl}" style="width:160px;max-height:110px;object-fit:contain;border:1px solid #d8dee5;background:#111820" />` : ""}</td>
          <td>${escapeHtml(item.detail)}</td>
        </tr>`
    )
    .join("");

  root.innerHTML = `
    <main style="max-width:1180px;margin:0 auto">
      <h1 style="margin:0 0 8px;font-size:26px">Phase 5 RAW Preview Diagnostics</h1>
      <p style="margin:0 0 10px;color:#53616f">Status: <strong>${report.status}</strong></p>
      <section style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px;margin:16px 0">
        <div style="background:white;padding:12px;border:1px solid #dfe4ea">Total<br><strong>${report.summary.total}</strong></div>
        <div style="background:white;padding:12px;border:1px solid #dfe4ea">Passed<br><strong>${report.summary.passed}</strong></div>
        <div style="background:white;padding:12px;border:1px solid #dfe4ea">Failed<br><strong>${report.summary.failed}</strong></div>
        <div style="background:white;padding:12px;border:1px solid #dfe4ea">Embedded<br><strong>${report.summary.embeddedPreview}</strong></div>
        <div style="background:white;padding:12px;border:1px solid #dfe4ea">Placeholder<br><strong>${report.summary.placeholderPreview}</strong></div>
        <div style="background:white;padding:12px;border:1px solid #dfe4ea">Sony<br><strong>${report.summary.sony}</strong></div>
        <div style="background:white;padding:12px;border:1px solid #dfe4ea">Nikon<br><strong>${report.summary.nikon}</strong></div>
      </section>
      <ul style="margin:0 0 16px;color:#53616f">${report.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
      <table style="width:100%;border-collapse:collapse;background:white;border:1px solid #dfe4ea">
        <thead><tr><th>Status</th><th>Name</th><th>Format</th><th>Preview</th><th>Brand</th><th>Model</th><th>Lens</th><th>ISO</th><th>Preview Size</th><th>Data URL</th><th>Time</th><th>Image</th><th>Detail</th></tr></thead>
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

const validateAsset = (
  sample: RawPreviewSample,
  asset: PhotoAsset,
  previewSize: { width: number; height: number }
) => {
  const failures: string[] = [];
  if (asset.sourceFormat !== "raw") failures.push(`expected sourceFormat raw, got ${asset.sourceFormat}`);
  if (asset.previewKind !== sample.expectedPreviewKind) {
    failures.push(`expected previewKind ${sample.expectedPreviewKind}, got ${asset.previewKind}`);
  }
  if (asset.cameraBrand !== sample.expectedBrand) failures.push(`expected brand ${sample.expectedBrand}, got ${asset.cameraBrand}`);
  if (asset.isEditable) failures.push("RAW asset must remain non-editable");
  if (!asset.previewUrl.startsWith("data:image/jpeg")) failures.push("previewUrl is not a JPEG data URL");
  if (previewSize.width < 320 || previewSize.height < 200) {
    failures.push(`preview is too small: ${previewSize.width}x${previewSize.height}`);
  }
  return failures;
};

const importSample = async (sample: RawPreviewSample): Promise<RawPreviewDiagnosticItem> => {
  const started = now();
  let asset: PhotoAsset | undefined;
  try {
    const response = await fetch(sample.url);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    const blob = await response.blob();
    const file = new File([blob], sample.name, { type: sample.type, lastModified: 1_788_800_000_000 });
    asset = await importPhotoFile(file, `phase5-raw-preview-${sample.name}`);
    const previewSize = await loadImageSize(asset.previewUrl);
    const failures = validateAsset(sample, asset, previewSize);
    return {
      name: sample.name,
      status: failures.length > 0 ? "failed" : "passed",
      detail: failures.length > 0 ? failures.join("; ") : "RAW imported with embedded preview and non-editable state",
      durationMs: now() - started,
      sourceFormat: asset.sourceFormat,
      previewKind: asset.previewKind,
      cameraBrand: asset.cameraBrand,
      isEditable: asset.isEditable,
      model: asset.metadata.model,
      lens: asset.metadata.lens,
      iso: asset.metadata.iso,
      previewWidth: previewSize.width,
      previewHeight: previewSize.height,
      previewUrl: asset.previewUrl,
      previewBytes: Math.round((asset.previewUrl.length * 3) / 4)
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

export const runPhase5RawPreviewDiagnostics = async () => {
  const root = makeRoot();
  const report = createEmptyReport();
  const started = now();
  window.__AUTO_PHOTO_PHASE5_RAW_PREVIEW_DIAGNOSTICS__ = report;
  renderReport(root, report);

  for (const sample of samples) {
    const item = await importSample(sample);
    report.items.push(item);
    if (item.status === "passed") report.summary.passed += 1;
    else report.summary.failed += 1;
    if (item.previewKind === "raw_embedded") report.summary.embeddedPreview += 1;
    if (item.previewKind === "raw_placeholder") report.summary.placeholderPreview += 1;
    if (item.cameraBrand === "Sony") report.summary.sony += 1;
    if (item.cameraBrand === "Nikon") report.summary.nikon += 1;
    renderReport(root, report);
  }

  report.status = report.summary.failed > 0 ? "failed" : "passed";
  report.finishedAt = new Date().toISOString();
  report.totalDurationMs = now() - started;
  renderReport(root, report);
  return report;
};
