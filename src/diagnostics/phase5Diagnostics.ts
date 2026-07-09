import { createDefaultEditParams, mergeEditParams } from "../services/editParams";
import { getProcessResourceSample, isTauriRuntime, saveDiagnosticReport } from "../services/desktopBridge";
import { calculateFileHash, importPhotoFile, renderEditedPreview } from "../services/imageProcessing";
import { disposePreviewWorker, renderPreviewWithWorkerFallback } from "../services/previewWorkerClient";
import type { ExportSettings, PhotoAsset, ProcessResourceSample } from "../types";

interface DiagnosticStep {
  name: string;
  status: "passed" | "failed";
  durationMs: number;
  detail: string;
}

interface DiagnosticReport {
  startedAt: string;
  finishedAt?: string;
  totalDurationMs?: number;
  savedReportPath?: string;
  config: {
    sampleCount: number;
    renderCount: number;
    batchCancelCount: number;
    stabilityCycles: number;
    stabilitySampleCount: number;
    stabilityRenderCount: number;
    stabilityPauseMs: number;
  };
  steps: DiagnosticStep[];
  memorySamples: MemorySample[];
  resourceSnapshots: ResourceSnapshot[];
  processSamples: ProcessResourceSnapshot[];
  stabilityMemoryTrend?: StabilityMemoryTrend;
  summary: {
    status: "running" | "passed" | "failed";
    importedCount: number;
    renderedCount: number;
    batchCancelPassed: boolean;
    abortPassed: boolean;
    activeObjectUrls: number;
    stabilityCyclesCompleted: number;
    stabilityImportedCount: number;
    stabilityRenderedCount: number;
    stabilityMemoryTrendStatus: StabilityMemoryTrend["status"];
  };
}

declare global {
  interface Window {
    __AUTO_PHOTO_PHASE5_DIAGNOSTICS__?: DiagnosticReport;
  }
}

const readPositiveIntegerEnv = (value: string | undefined, fallback: number, max: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const readNonNegativeIntegerEnv = (value: string | undefined, fallback: number, max: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
};

const SAMPLE_COUNT = readPositiveIntegerEnv(import.meta.env.VITE_AUTO_PHOTO_PHASE5_SAMPLE_COUNT, 100, 500);
const RENDER_COUNT = Math.min(
  SAMPLE_COUNT,
  readPositiveIntegerEnv(import.meta.env.VITE_AUTO_PHOTO_PHASE5_RENDER_COUNT, 24, SAMPLE_COUNT)
);
const BATCH_CANCEL_COUNT = Math.min(
  SAMPLE_COUNT,
  readPositiveIntegerEnv(import.meta.env.VITE_AUTO_PHOTO_PHASE5_BATCH_CANCEL_COUNT, 50, SAMPLE_COUNT)
);
const STABILITY_CYCLES = readNonNegativeIntegerEnv(import.meta.env.VITE_AUTO_PHOTO_PHASE5_STABILITY_CYCLES, 0, 50);
const STABILITY_SAMPLE_COUNT = readPositiveIntegerEnv(import.meta.env.VITE_AUTO_PHOTO_PHASE5_STABILITY_SAMPLE_COUNT, 16, 200);
const STABILITY_RENDER_COUNT = Math.min(
  STABILITY_SAMPLE_COUNT,
  readPositiveIntegerEnv(import.meta.env.VITE_AUTO_PHOTO_PHASE5_STABILITY_RENDER_COUNT, 8, STABILITY_SAMPLE_COUNT)
);
const STABILITY_PAUSE_MS = readNonNegativeIntegerEnv(import.meta.env.VITE_AUTO_PHOTO_PHASE5_STABILITY_PAUSE_MS, 250, 10_000);

interface MemorySample {
  label: string;
  usedJSHeapSize?: number;
  totalJSHeapSize?: number;
  jsHeapSizeLimit?: number;
}

interface ResourceSnapshot {
  label: string;
  createdObjectUrls: number;
  revokedObjectUrls: number;
  activeObjectUrls: number;
}

interface ProcessResourceSnapshot extends ProcessResourceSample {
  label: string;
  error?: string;
}

interface StabilityMemoryTrendPoint {
  label: string;
  workingSetBytes?: number;
  privateMemoryBytes?: number;
  workingSetDeltaFromFirst?: number;
  privateMemoryDeltaFromFirst?: number;
}

interface StabilityMemoryTrend {
  status: "not-run" | "insufficient-data" | "passed" | "warning";
  detail: string;
  cleanupSampleCount: number;
  workingSetDeltaBytes?: number;
  privateMemoryDeltaBytes?: number;
  thresholdBytes: number;
  points: StabilityMemoryTrendPoint[];
}

const exportSettings: ExportSettings = {
  quality: 88,
  maxEdge: 1200,
  filenamePrefix: "",
  filenameSuffix: "_diagnostic",
  includeSequence: true,
  conflictStrategy: "rename",
  preserveExif: false,
  watermarkText: "Phase 5",
  watermarkPosition: "bottom-right",
  watermarkOpacity: 55,
  watermarkSize: 3
};

const now = () => performance.now();
const delay = (durationMs: number) => new Promise((resolve) => window.setTimeout(resolve, durationMs));

const readMemorySample = (label: string): MemorySample => {
  const memory = (performance as Performance & {
    memory?: {
      usedJSHeapSize?: number;
      totalJSHeapSize?: number;
      jsHeapSizeLimit?: number;
    };
  }).memory;
  return {
    label,
    usedJSHeapSize: memory?.usedJSHeapSize,
    totalJSHeapSize: memory?.totalJSHeapSize,
    jsHeapSizeLimit: memory?.jsHeapSizeLimit
  };
};

const formatBytes = (value?: number) => {
  if (typeof value !== "number") return "n/a";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const calculateGrowthThreshold = (baseline?: number) => Math.max(64 * 1024 * 1024, (baseline ?? 0) * 0.25);

const analyzeStabilityMemoryTrend = (report: DiagnosticReport): StabilityMemoryTrend => {
  if (report.config.stabilityCycles === 0) {
    return {
      status: "not-run",
      detail: "Stability cycles were not enabled.",
      cleanupSampleCount: 0,
      thresholdBytes: 64 * 1024 * 1024,
      points: []
    };
  }

  const cleanupSamples = report.processSamples.filter((sample) => /^stability \d+ after cleanup$/.test(sample.label));
  const first = cleanupSamples[0];
  const last = cleanupSamples[cleanupSamples.length - 1];
  const firstWorkingSet = first?.workingSetBytes;
  const firstPrivate = first?.privateMemoryBytes;
  const thresholdBytes = calculateGrowthThreshold(firstWorkingSet ?? firstPrivate);
  const points = cleanupSamples.map((sample) => ({
    label: sample.label,
    workingSetBytes: sample.workingSetBytes,
    privateMemoryBytes: sample.privateMemoryBytes,
    workingSetDeltaFromFirst:
      typeof sample.workingSetBytes === "number" && typeof firstWorkingSet === "number"
        ? sample.workingSetBytes - firstWorkingSet
        : undefined,
    privateMemoryDeltaFromFirst:
      typeof sample.privateMemoryBytes === "number" && typeof firstPrivate === "number"
        ? sample.privateMemoryBytes - firstPrivate
        : undefined
  }));

  if (cleanupSamples.length < 2 || !last) {
    return {
      status: "insufficient-data",
      detail: "Need at least two stability cleanup process samples to evaluate memory trend.",
      cleanupSampleCount: cleanupSamples.length,
      thresholdBytes,
      points
    };
  }

  const workingSetDelta =
    typeof last.workingSetBytes === "number" && typeof firstWorkingSet === "number"
      ? last.workingSetBytes - firstWorkingSet
      : undefined;
  const privateMemoryDelta =
    typeof last.privateMemoryBytes === "number" && typeof firstPrivate === "number"
      ? last.privateMemoryBytes - firstPrivate
      : undefined;
  const hasWarning =
    (typeof workingSetDelta === "number" && workingSetDelta > thresholdBytes) ||
    (typeof privateMemoryDelta === "number" && privateMemoryDelta > thresholdBytes);

  return {
    status: hasWarning ? "warning" : "passed",
    detail: hasWarning
      ? `Cleanup memory growth exceeded ${formatBytes(thresholdBytes)} threshold.`
      : `Cleanup memory growth stayed within ${formatBytes(thresholdBytes)} threshold.`,
    cleanupSampleCount: cleanupSamples.length,
    workingSetDeltaBytes: workingSetDelta,
    privateMemoryDeltaBytes: privateMemoryDelta,
    thresholdBytes,
    points
  };
};

const createObjectUrlMonitor = () => {
  const originalCreate = URL.createObjectURL.bind(URL);
  const originalRevoke = URL.revokeObjectURL.bind(URL);
  const active = new Set<string>();
  let created = 0;
  let revoked = 0;

  URL.createObjectURL = (object: Blob | MediaSource) => {
    const url = originalCreate(object);
    active.add(url);
    created += 1;
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    if (active.delete(url)) revoked += 1;
    originalRevoke(url);
  };

  return {
    snapshot: (label: string): ResourceSnapshot => ({
      label,
      createdObjectUrls: created,
      revokedObjectUrls: revoked,
      activeObjectUrls: active.size
    }),
    restore: () => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  };
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

const renderReport = (root: HTMLElement, report: DiagnosticReport) => {
  const rows = report.steps
    .map(
      (step) =>
        `<tr><td>${step.status}</td><td>${step.name}</td><td>${Math.round(step.durationMs)} ms</td><td>${step.detail}</td></tr>`
    )
    .join("");
  const memoryRows = report.memorySamples
    .map(
      (sample) =>
        `<tr><td>${sample.label}</td><td>${formatBytes(sample.usedJSHeapSize)}</td><td>${formatBytes(sample.totalJSHeapSize)}</td><td>${formatBytes(sample.jsHeapSizeLimit)}</td></tr>`
    )
    .join("");
  const resourceRows = report.resourceSnapshots
    .map(
      (snapshot) =>
        `<tr><td>${snapshot.label}</td><td>${snapshot.createdObjectUrls}</td><td>${snapshot.revokedObjectUrls}</td><td>${snapshot.activeObjectUrls}</td></tr>`
    )
    .join("");
  const processRows = report.processSamples
    .map(
      (sample) =>
        `<tr><td>${sample.label}</td><td>${sample.pid}</td><td>${sample.platform}</td><td>${formatBytes(sample.workingSetBytes)}</td><td>${formatBytes(sample.peakWorkingSetBytes)}</td><td>${formatBytes(sample.privateMemoryBytes)}</td><td>${sample.error ?? ""}</td></tr>`
    )
    .join("");
  const trend = report.stabilityMemoryTrend;
  const trendRows =
    trend?.points
      .map(
        (point) =>
          `<tr><td>${point.label}</td><td>${formatBytes(point.workingSetBytes)}</td><td>${formatBytes(point.workingSetDeltaFromFirst)}</td><td>${formatBytes(point.privateMemoryBytes)}</td><td>${formatBytes(point.privateMemoryDeltaFromFirst)}</td></tr>`
      )
      .join("") ?? "";
  root.innerHTML = `
    <main style="max-width: 1040px; margin: 0 auto;">
      <h1 style="margin: 0 0 8px; font-size: 26px;">Phase 5 Diagnostics</h1>
      <p style="margin: 0 0 18px; color: #53616f;">Status: <strong>${report.summary.status}</strong></p>
      ${report.savedReportPath ? `<p style="margin: -8px 0 18px; color: #53616f; word-break: break-all;">Saved report: ${report.savedReportPath}</p>` : ""}
      <p style="margin: -8px 0 18px; color: #53616f;">Config: ${report.config.sampleCount} samples / ${report.config.renderCount} renders / ${report.config.batchCancelCount} batch cancel items / ${report.config.stabilityCycles} stability cycles</p>
      <section style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-bottom: 18px;">
        <div style="background: white; padding: 14px; border: 1px solid #dfe4ea;">Imported<br><strong>${report.summary.importedCount}</strong></div>
        <div style="background: white; padding: 14px; border: 1px solid #dfe4ea;">Rendered<br><strong>${report.summary.renderedCount}</strong></div>
        <div style="background: white; padding: 14px; border: 1px solid #dfe4ea;">Abort<br><strong>${report.summary.abortPassed ? "passed" : "pending"}</strong></div>
        <div style="background: white; padding: 14px; border: 1px solid #dfe4ea;">Batch Cancel<br><strong>${report.summary.batchCancelPassed ? "passed" : "pending"}</strong></div>
        <div style="background: white; padding: 14px; border: 1px solid #dfe4ea;">Object URLs<br><strong>${report.summary.activeObjectUrls}</strong></div>
        <div style="background: white; padding: 14px; border: 1px solid #dfe4ea;">Stability<br><strong>${report.summary.stabilityCyclesCompleted}/${report.config.stabilityCycles}</strong></div>
        <div style="background: white; padding: 14px; border: 1px solid #dfe4ea;">Trend<br><strong>${report.summary.stabilityMemoryTrendStatus}</strong></div>
        <div style="background: white; padding: 14px; border: 1px solid #dfe4ea;">Duration<br><strong>${Math.round(report.totalDurationMs ?? 0)} ms</strong></div>
      </section>
      <table style="width: 100%; border-collapse: collapse; background: white; border: 1px solid #dfe4ea;">
        <thead><tr><th>Status</th><th>Step</th><th>Duration</th><th>Detail</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <h2 style="font-size: 17px; margin: 22px 0 8px;">Memory Samples</h2>
      <table style="width: 100%; border-collapse: collapse; background: white; border: 1px solid #dfe4ea;">
        <thead><tr><th>Label</th><th>Used JS Heap</th><th>Total JS Heap</th><th>Limit</th></tr></thead>
        <tbody>${memoryRows}</tbody>
      </table>
      <h2 style="font-size: 17px; margin: 22px 0 8px;">Object URL Tracking</h2>
      <table style="width: 100%; border-collapse: collapse; background: white; border: 1px solid #dfe4ea;">
        <thead><tr><th>Label</th><th>Created</th><th>Revoked</th><th>Active</th></tr></thead>
        <tbody>${resourceRows}</tbody>
      </table>
      <h2 style="font-size: 17px; margin: 22px 0 8px;">Desktop Process Samples</h2>
      <table style="width: 100%; border-collapse: collapse; background: white; border: 1px solid #dfe4ea;">
        <thead><tr><th>Label</th><th>PID</th><th>Platform</th><th>Working Set</th><th>Peak Working Set</th><th>Private Bytes</th><th>Error</th></tr></thead>
        <tbody>${processRows}</tbody>
      </table>
      <h2 style="font-size: 17px; margin: 22px 0 8px;">Stability Memory Trend</h2>
      <p style="margin: 0 0 8px; color: #53616f;">${trend ? `${trend.status}: ${trend.detail}` : "pending"}</p>
      <table style="width: 100%; border-collapse: collapse; background: white; border: 1px solid #dfe4ea;">
        <thead><tr><th>Cleanup Sample</th><th>Working Set</th><th>Working Delta</th><th>Private Bytes</th><th>Private Delta</th></tr></thead>
        <tbody>${trendRows}</tbody>
      </table>
    </main>
  `;
  root.querySelectorAll("th,td").forEach((cell) => {
    const element = cell as HTMLElement;
    element.style.textAlign = "left";
    element.style.borderBottom = "1px solid #edf0f3";
    element.style.padding = "10px 12px";
    element.style.fontSize = "13px";
  });
};

const canvasToFile = (canvas: HTMLCanvasElement, name: string) =>
  new Promise<File>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`Could not encode ${name}`));
          return;
        }
        resolve(new File([blob], name, { type: "image/jpeg", lastModified: 1_788_800_000_000 }));
      },
      "image/jpeg",
      0.88
    );
  });

const createSyntheticJpg = async (index: number, width = 1280, height = 840) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create sample canvas");

  const hue = (index * 29) % 360;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `hsl(${hue}, 58%, 72%)`);
  gradient.addColorStop(0.55, `hsl(${(hue + 80) % 360}, 42%, 48%)`);
  gradient.addColorStop(1, `hsl(${(hue + 170) % 360}, 55%, 24%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255, 238, 214, 0.72)";
  ctx.beginPath();
  ctx.ellipse(width * 0.32, height * 0.46, width * 0.12, height * 0.17, -0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(68, 42, 34, 0.42)";
  ctx.beginPath();
  ctx.ellipse(width * 0.32, height * 0.36, width * 0.14, height * 0.07, -0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.22)";
  for (let stripe = 0; stripe < 7; stripe += 1) {
    ctx.fillRect(width * (0.5 + stripe * 0.055), height * 0.18, width * 0.026, height * 0.64);
  }

  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.font = '700 42px "Segoe UI", sans-serif';
  ctx.fillText(`P5-${String(index + 1).padStart(3, "0")}`, 46, height - 52);
  return canvasToFile(canvas, `phase5-sample-${String(index + 1).padStart(3, "0")}.jpg`);
};

const timeStep = async (report: DiagnosticReport, name: string, run: () => Promise<string>) => {
  const started = now();
  try {
    const detail = await run();
    report.steps.push({ name, status: "passed", durationMs: now() - started, detail });
  } catch (error) {
    report.steps.push({
      name,
      status: "failed",
      durationMs: now() - started,
      detail: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

const cleanupAssets = (assets: PhotoAsset[]) => {
  for (const asset of assets) {
    if (asset.objectUrl.startsWith("blob:")) URL.revokeObjectURL(asset.objectUrl);
  }
  disposePreviewWorker();
};

const isAbortError = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

export const runPhase5Diagnostics = async () => {
  const root = makeRoot();
  const report: DiagnosticReport = {
    startedAt: new Date().toISOString(),
    config: {
      sampleCount: SAMPLE_COUNT,
      renderCount: RENDER_COUNT,
      batchCancelCount: BATCH_CANCEL_COUNT,
      stabilityCycles: STABILITY_CYCLES,
      stabilitySampleCount: STABILITY_SAMPLE_COUNT,
      stabilityRenderCount: STABILITY_RENDER_COUNT,
      stabilityPauseMs: STABILITY_PAUSE_MS
    },
    steps: [],
    memorySamples: [],
    resourceSnapshots: [],
    processSamples: [],
    summary: {
      status: "running",
      importedCount: 0,
      renderedCount: 0,
      batchCancelPassed: false,
      activeObjectUrls: 0,
      abortPassed: false,
      stabilityCyclesCompleted: 0,
      stabilityImportedCount: 0,
      stabilityRenderedCount: 0,
      stabilityMemoryTrendStatus: "not-run"
    }
  };
  window.__AUTO_PHOTO_PHASE5_DIAGNOSTICS__ = report;
  renderReport(root, report);

  const started = now();
  const files: File[] = [];
  const assets: PhotoAsset[] = [];
  const urlMonitor = createObjectUrlMonitor();

  const captureResources = async (label: string) => {
    report.memorySamples.push(readMemorySample(label));
    const snapshot = urlMonitor.snapshot(label);
    report.resourceSnapshots.push(snapshot);
    report.summary.activeObjectUrls = snapshot.activeObjectUrls;
    if (isTauriRuntime()) {
      try {
        const processSample = await getProcessResourceSample();
        if (processSample) report.processSamples.push({ label, ...processSample });
      } catch (error) {
        report.processSamples.push({
          label,
          pid: 0,
          platform: "unknown",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  };

  try {
    await captureResources("start");
    await timeStep(report, `generate ${SAMPLE_COUNT} synthetic JPG files`, async () => {
      for (let index = 0; index < SAMPLE_COUNT; index += 1) {
        files.push(await createSyntheticJpg(index));
      }
      return `${files.length} files generated`;
    });
    await captureResources("after generate");
    renderReport(root, report);

    await timeStep(report, `import ${SAMPLE_COUNT} JPG files`, async () => {
      for (const file of files) {
        assets.push(await importPhotoFile(file, await calculateFileHash(file)));
      }
      report.summary.importedCount = assets.length;
      const editableCount = assets.filter((asset) => asset.isEditable).length;
      if (editableCount !== SAMPLE_COUNT) throw new Error(`Expected ${SAMPLE_COUNT} editable assets, got ${editableCount}`);
      return `${editableCount} editable JPG assets`;
    });
    await captureResources("after import");
    renderReport(root, report);

    await timeStep(report, `render ${RENDER_COUNT} previews with worker fallback`, async () => {
      for (let index = 0; index < RENDER_COUNT; index += 1) {
        const asset = assets[index];
        const edits = mergeEditParams(createDefaultEditParams(), {
          exposure: (index % 7) - 3,
          temperature: (index % 5) * 4 - 8,
          contrast: 8,
          vibrance: 10,
          clarity: 4,
          sharpness: 8,
          skinProtection: 40
        });
        const dataUrl = await renderPreviewWithWorkerFallback(asset, edits, { maxEdge: 900, quality: 0.84 });
        if (!dataUrl.startsWith("data:image/jpeg")) throw new Error(`Preview ${index + 1} did not return JPG data URL`);
        report.summary.renderedCount += 1;
      }
      return `${report.summary.renderedCount} previews rendered`;
    });
    await captureResources("after preview render");
    renderReport(root, report);

    await timeStep(report, "render export preview with watermark", async () => {
      const dataUrl = await renderPreviewWithWorkerFallback(assets[0], assets[0].edits, {
        maxEdge: exportSettings.maxEdge,
        quality: exportSettings.quality / 100,
        exportSettings
      });
      if (!dataUrl.startsWith("data:image/jpeg")) throw new Error("Export render did not return JPG data URL");
      return `${Math.round(dataUrl.length / 1024)} KB data URL`;
    });
    await captureResources("after export render");
    renderReport(root, report);

    await timeStep(report, `cancel ${BATCH_CANCEL_COUNT}-item batch render`, async () => {
      const controller = new AbortController();
      let completed = 0;
      let aborted = false;
      const abortSoon = window.setTimeout(() => controller.abort(), 1);
      try {
        for (let index = 0; index < BATCH_CANCEL_COUNT; index += 1) {
          try {
            await renderPreviewWithWorkerFallback(assets[index], assets[index].edits, {
              maxEdge: 1700,
              quality: 0.9,
              exportSettings,
              signal: controller.signal
            });
            completed += 1;
          } catch (error) {
            if (isAbortError(error)) {
              aborted = true;
              break;
            }
            throw error;
          }
        }
      } finally {
        window.clearTimeout(abortSoon);
      }
      if (!aborted) throw new Error(`Batch render completed ${completed} items without aborting`);
      report.summary.batchCancelPassed = true;
      return `aborted after ${completed}/${BATCH_CANCEL_COUNT} completed renders`;
    });
    await captureResources("after batch cancel");
    renderReport(root, report);

    await timeStep(report, "abort current worker render", async () => {
      const controller = new AbortController();
      const largeFile = await createSyntheticJpg(999, 2600, 1800);
      const largeAsset = await importPhotoFile(largeFile, await calculateFileHash(largeFile));
      const renderPromise = renderPreviewWithWorkerFallback(largeAsset, largeAsset.edits, {
        maxEdge: 2400,
        quality: 0.9,
        signal: controller.signal
      });
      controller.abort();
      try {
        await renderPromise;
      } catch (error) {
        if (isAbortError(error)) {
          report.summary.abortPassed = true;
          cleanupAssets([largeAsset]);
          return "AbortError observed";
        }
        cleanupAssets([largeAsset]);
        throw error;
      }
      cleanupAssets([largeAsset]);
      throw new Error("Render completed instead of aborting");
    });
    renderReport(root, report);

    await timeStep(report, "main-thread fallback abort check", async () => {
      const controller = new AbortController();
      const fallbackAsset = assets[Math.min(1, assets.length - 1)];
      controller.abort();
      try {
        await renderEditedPreview(fallbackAsset, fallbackAsset.edits, { signal: controller.signal });
      } catch (error) {
        if (isAbortError(error)) return "AbortError observed before fallback render";
        throw error;
      }
      throw new Error("Fallback render completed instead of aborting");
    });
    await captureResources("after abort checks");

    if (STABILITY_CYCLES > 0) {
      await timeStep(report, `run ${STABILITY_CYCLES} desktop stability cycles`, async () => {
        for (let cycle = 0; cycle < STABILITY_CYCLES; cycle += 1) {
          const cycleNumber = cycle + 1;
          const cycleAssets: PhotoAsset[] = [];
          await captureResources(`stability ${cycleNumber} start`);

          for (let index = 0; index < STABILITY_SAMPLE_COUNT; index += 1) {
            const file = await createSyntheticJpg(10_000 + cycle * STABILITY_SAMPLE_COUNT + index, 1200, 800);
            cycleAssets.push(await importPhotoFile(file, await calculateFileHash(file)));
          }
          report.summary.stabilityImportedCount += cycleAssets.length;
          await captureResources(`stability ${cycleNumber} after import`);

          for (let index = 0; index < STABILITY_RENDER_COUNT; index += 1) {
            const asset = cycleAssets[index];
            const edits = mergeEditParams(createDefaultEditParams(), {
              exposure: ((cycle + index) % 7) - 3,
              temperature: ((cycle + index) % 5) * 3 - 6,
              contrast: 6,
              vibrance: 8,
              clarity: 3,
              sharpness: 6
            });
            const dataUrl = await renderPreviewWithWorkerFallback(asset, edits, { maxEdge: 860, quality: 0.82 });
            if (!dataUrl.startsWith("data:image/jpeg")) {
              cleanupAssets(cycleAssets);
              throw new Error(`Stability cycle ${cycleNumber} render ${index + 1} did not return JPG data URL`);
            }
            report.summary.stabilityRenderedCount += 1;
          }
          await captureResources(`stability ${cycleNumber} after render`);

          cleanupAssets(cycleAssets);
          report.summary.stabilityCyclesCompleted = cycleNumber;
          await captureResources(`stability ${cycleNumber} after cleanup`);
          renderReport(root, report);
          if (STABILITY_PAUSE_MS > 0 && cycleNumber < STABILITY_CYCLES) await delay(STABILITY_PAUSE_MS);
        }
        return `${report.summary.stabilityCyclesCompleted} cycles, ${report.summary.stabilityImportedCount} imports, ${report.summary.stabilityRenderedCount} renders`;
      });
    }

    report.summary.status = "passed";
  } catch {
    report.summary.status = "failed";
  } finally {
    cleanupAssets(assets);
    await captureResources("after cleanup");
    urlMonitor.restore();
    report.stabilityMemoryTrend = analyzeStabilityMemoryTrend(report);
    report.summary.stabilityMemoryTrendStatus = report.stabilityMemoryTrend.status;
    report.finishedAt = new Date().toISOString();
    report.totalDurationMs = now() - started;
    if (isTauriRuntime()) {
      const saveStarted = now();
      try {
        const savedPath = await saveDiagnosticReport("phase5-process", report);
        if (savedPath) {
          report.savedReportPath = savedPath;
          report.steps.push({
            name: "save diagnostic report",
            status: "passed",
            durationMs: now() - saveStarted,
            detail: savedPath
          });
        }
      } catch (error) {
        report.steps.push({
          name: "save diagnostic report",
          status: "failed",
          durationMs: now() - saveStarted,
          detail: error instanceof Error ? error.message : String(error)
        });
        if (report.summary.status === "passed") report.summary.status = "failed";
      }
    }
    renderReport(root, report);
  }

  return report;
};
