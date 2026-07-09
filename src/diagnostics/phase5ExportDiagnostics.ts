import {
  createExportDiagnosticDirectory,
  isTauriRuntime,
  listExportJobs,
  recordExportJob,
  saveDiagnosticReport,
  saveExportFile
} from "../services/desktopBridge";
import { calculateFileHash, createRawEmbeddedSourceUrl, importPhotoFile, renderImageSourceWithEdits } from "../services/imageProcessing";
import { renderPreviewWithWorkerFallback } from "../services/previewWorkerClient";
import type { ExportConflictStrategy, ExportJobRecord, ExportSettings, PhotoAsset } from "../types";

interface ExportDiagnosticStep {
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  detail: string;
}

interface ExportDiagnosticReport {
  startedAt: string;
  finishedAt?: string;
  totalDurationMs?: number;
  savedReportPath?: string;
  steps: ExportDiagnosticStep[];
  summary: {
    status: "running" | "passed" | "failed" | "skipped";
    outputDir?: string;
    requestedCount: number;
    writtenCount: number;
    cancelledAt: number;
    failedCount: number;
    historyVerified: boolean;
    mixedRequestedCount: number;
    mixedWrittenCount: number;
    mixedRawWritten: boolean;
    mixedRawWrittenCount: number;
    mixedHistoryVerified: boolean;
  };
  writtenFiles: Array<{
    name: string;
    path?: string;
    skipped: boolean;
  }>;
}

declare global {
  interface Window {
    __AUTO_PHOTO_PHASE5_EXPORT_DIAGNOSTICS__?: ExportDiagnosticReport;
  }
}

const EXPORT_COUNT = 18;
const CANCEL_AFTER_WRITES = 5;
const RAW_SAMPLES = [
  {
    label: "Nikon RAW",
    url: "/image/nikon/DSC_2156.NEF",
    name: "DSC_2156.NEF",
    type: "image/x-nikon-nef"
  },
  {
    label: "Sony RAW",
    url: "/image/sony/20230813-0192.ARW",
    name: "20230813-0192.ARW",
    type: "image/x-sony-arw"
  }
];
const MIXED_EXPORT_COUNT = 1 + RAW_SAMPLES.length;

const exportSettings: ExportSettings = {
  quality: 86,
  maxEdge: 1100,
  filenamePrefix: "diag_",
  filenameSuffix: "_cancel",
  includeSequence: true,
  conflictStrategy: "rename" as ExportConflictStrategy,
  preserveExif: false,
  watermarkText: "Phase 5 Export",
  watermarkPosition: "bottom-right",
  watermarkOpacity: 45,
  watermarkSize: 3
};

const now = () => performance.now();

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

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

const createSyntheticJpg = async (index: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = 1320;
  canvas.height = 880;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create export diagnostic canvas");

  const hue = (index * 37) % 360;
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, `hsl(${hue}, 58%, 70%)`);
  gradient.addColorStop(0.55, `hsl(${(hue + 90) % 360}, 48%, 44%)`);
  gradient.addColorStop(1, `hsl(${(hue + 190) % 360}, 42%, 24%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255, 236, 214, 0.72)";
  ctx.beginPath();
  ctx.ellipse(canvas.width * 0.34, canvas.height * 0.48, 150, 180, -0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.2)";
  for (let stripe = 0; stripe < 8; stripe += 1) {
    ctx.fillRect(canvas.width * (0.52 + stripe * 0.045), 150, 26, 560);
  }

  ctx.fillStyle = "rgba(0,0,0,0.24)";
  ctx.font = '700 44px "Segoe UI", sans-serif';
  ctx.fillText(`EXPORT-${String(index + 1).padStart(2, "0")}`, 44, canvas.height - 48);
  return canvasToFile(canvas, `phase5-export-${String(index + 1).padStart(2, "0")}.jpg`);
};

const createExportName = (asset: PhotoAsset, index: number) => {
  const stem = asset.name.replace(/\.[^.]+$/, "");
  const sequence = exportSettings.includeSequence ? `${String(index + 1).padStart(4, "0")}_` : "";
  return `${exportSettings.filenamePrefix}${sequence}${stem}${exportSettings.filenameSuffix}.jpg`;
};

const fetchRawFile = async (sample: (typeof RAW_SAMPLES)[number]) => {
  const response = await fetch(sample.url);
  if (!response.ok) throw new Error(`${sample.label} fetch failed: ${response.status} ${response.statusText}`);
  const blob = await response.blob();
  return new File([blob], sample.name, { type: sample.type, lastModified: 1_788_800_000_000 });
};

const renderDiagnosticExport = async (asset: PhotoAsset) => {
  if (asset.isEditable) {
    return renderPreviewWithWorkerFallback(asset, asset.edits, {
      maxEdge: exportSettings.maxEdge,
      quality: exportSettings.quality / 100,
      exportSettings
    });
  }
  if (asset.previewKind === "raw_embedded") {
    const sourceUrl = await createRawEmbeddedSourceUrl(asset.file);
    if (!sourceUrl) throw new Error(`RAW embedded preview not available for ${asset.name}`);
    return renderImageSourceWithEdits(sourceUrl, asset.edits, {
      maxEdge: exportSettings.maxEdge,
      quality: exportSettings.quality / 100,
      exportSettings,
      orientation: asset.metadata.orientation
    });
  }
  throw new Error(`RAW placeholder cannot be exported: ${asset.name}`);
};

const cleanupAssets = (assets: PhotoAsset[]) => {
  for (const asset of assets) {
    if (asset.objectUrl.startsWith("blob:")) URL.revokeObjectURL(asset.objectUrl);
  }
};

const renderReport = (report: ExportDiagnosticReport) => {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");
  const rows = report.steps
    .map((step) => `<tr><td>${step.status}</td><td>${step.name}</td><td>${Math.round(step.durationMs)} ms</td><td>${step.detail}</td></tr>`)
    .join("");
  const files = report.writtenFiles
    .map((file) => `<tr><td>${file.name}</td><td>${file.skipped ? "skipped" : "written"}</td><td>${file.path ?? ""}</td></tr>`)
    .join("");
  root.innerHTML = `
    <main style="max-width:1040px;margin:0 auto;padding:24px;font-family:Segoe UI,Arial,sans-serif;color:#17202a">
      <h1 style="margin:0 0 8px;font-size:26px">Phase 5 Export Diagnostics</h1>
      <p>Status: <strong>${report.summary.status}</strong></p>
      <section style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:18px 0">
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Requested<br><strong>${report.summary.requestedCount}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Written<br><strong>${report.summary.writtenCount}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Cancelled At<br><strong>${report.summary.cancelledAt}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Failed<br><strong>${report.summary.failedCount}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">History<br><strong>${report.summary.historyVerified ? "verified" : "pending"}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Duration<br><strong>${Math.round(report.totalDurationMs ?? 0)} ms</strong></div>
      </section>
      <section style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0">
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Mixed Requested<br><strong>${report.summary.mixedRequestedCount}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Mixed Written<br><strong>${report.summary.mixedWrittenCount}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">RAW Preview<br><strong>${report.summary.mixedRawWrittenCount}/${RAW_SAMPLES.length}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Mixed History<br><strong>${report.summary.mixedHistoryVerified ? "verified" : "pending"}</strong></div>
      </section>
      <p style="word-break:break-all">Output: ${report.summary.outputDir ?? "n/a"}</p>
      <table style="width:100%;border-collapse:collapse;background:white;border:1px solid #dfe4ea"><tbody>${rows}</tbody></table>
      <h2 style="font-size:17px;margin:22px 0 8px">Written Files</h2>
      <table style="width:100%;border-collapse:collapse;background:white;border:1px solid #dfe4ea"><tbody>${files}</tbody></table>
    </main>
  `;
  root.querySelectorAll("td").forEach((cell) => {
    const element = cell as HTMLElement;
    element.style.borderTop = "1px solid #edf0f3";
    element.style.padding = "8px 10px";
    element.style.fontSize = "13px";
  });
};

const runStep = async (report: ExportDiagnosticReport, name: string, run: () => Promise<string>, status: "passed" | "skipped" = "passed") => {
  const started = now();
  try {
    const detail = await run();
    report.steps.push({ name, status, durationMs: now() - started, detail });
  } catch (error) {
    report.steps.push({
      name,
      status: "failed",
      durationMs: now() - started,
      detail: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    renderReport(report);
  }
};

export const runPhase5ExportDiagnostics = async () => {
  const report: ExportDiagnosticReport = {
    startedAt: new Date().toISOString(),
    steps: [],
    writtenFiles: [],
    summary: {
      status: "running",
      requestedCount: EXPORT_COUNT,
      writtenCount: 0,
      cancelledAt: 0,
      failedCount: 0,
      historyVerified: false,
      mixedRequestedCount: MIXED_EXPORT_COUNT,
      mixedWrittenCount: 0,
      mixedRawWritten: false,
      mixedRawWrittenCount: 0,
      mixedHistoryVerified: false
    }
  };
  window.__AUTO_PHOTO_PHASE5_EXPORT_DIAGNOSTICS__ = report;
  const started = now();
  const assets: PhotoAsset[] = [];
  renderReport(report);

  try {
    if (!isTauriRuntime()) {
      await runStep(
        report,
        "skip outside Tauri runtime",
        async () => "This diagnostic requires Tauri so it can write to a real desktop output directory.",
        "skipped"
      );
      report.summary.status = "skipped";
    } else {
      await runStep(report, "create export diagnostic directory", async () => {
        const outputDir = await createExportDiagnosticDirectory();
        report.summary.outputDir = outputDir;
        return outputDir;
      });

      await runStep(report, `generate and import ${EXPORT_COUNT} synthetic JPG files`, async () => {
        for (let index = 0; index < EXPORT_COUNT; index += 1) {
          const file = await createSyntheticJpg(index);
          assets.push(await importPhotoFile(file, await calculateFileHash(file)));
        }
        return `${assets.length} imported assets`;
      });

      await runStep(report, `write batch exports then cancel after ${CANCEL_AFTER_WRITES}`, async () => {
        let cancelRequested = false;
        const exportItems: NonNullable<ExportJobRecord["items"]> = [];
        for (let index = 0; index < assets.length; index += 1) {
          if (cancelRequested) {
            report.summary.cancelledAt = index;
            break;
          }
          const asset = assets[index];
          const dataUrl = await renderPreviewWithWorkerFallback(asset, asset.edits, {
            maxEdge: exportSettings.maxEdge,
            quality: exportSettings.quality / 100,
            exportSettings
          });
          const saved = await saveExportFile(
            report.summary.outputDir as string,
            createExportName(asset, index),
            dataUrl,
            exportSettings.conflictStrategy
          );
          report.writtenFiles.push({ name: saved.fileName, path: saved.path, skipped: saved.skipped });
          exportItems.push({
            assetId: asset.id,
            name: asset.name,
            status: saved.skipped ? "skipped" : "written",
            requestedName: createExportName(asset, index),
            outputName: saved.fileName,
            outputPath: saved.path
          });
          if (!saved.skipped) report.summary.writtenCount += 1;
          await delay(25);
          if (report.summary.writtenCount >= CANCEL_AFTER_WRITES) {
            cancelRequested = true;
          }
        }
        if (report.summary.writtenCount !== CANCEL_AFTER_WRITES) {
          throw new Error(`Expected ${CANCEL_AFTER_WRITES} writes before cancel, got ${report.summary.writtenCount}`);
        }
        if (report.summary.cancelledAt <= 0 || report.summary.cancelledAt >= EXPORT_COUNT) {
          throw new Error(`Cancel boundary was not observed: ${report.summary.cancelledAt}`);
        }
        await recordExportJob({
          mode: "batch",
          status: "cancelled",
          totalCount: EXPORT_COUNT,
          completedCount: report.summary.writtenCount,
          failedCount: 0,
          outputDir: report.summary.outputDir,
          items: exportItems,
          failed: []
        });
        const history = await listExportJobs(1);
        const latest = history[0];
        if (!latest || latest.status !== "cancelled" || latest.completedCount !== report.summary.writtenCount) {
          throw new Error("Export history did not include the latest cancelled diagnostic job");
        }
        report.summary.historyVerified = true;
        return `cancelled at ${report.summary.cancelledAt}/${EXPORT_COUNT}`;
      });

      await runStep(report, "write mixed JPG, Nikon RAW and Sony RAW embedded preview exports", async () => {
        const mixedAssets = [
          await importPhotoFile(await createSyntheticJpg(EXPORT_COUNT), "phase5-export-mixed-jpg"),
          ...(await Promise.all(RAW_SAMPLES.map((sample) => fetchRawFile(sample).then((file) => importPhotoFile(file, `phase5-export-mixed-${sample.name}`)))))
        ];
        assets.push(...mixedAssets);
        const rawAssets = mixedAssets.filter((asset) => asset.sourceFormat === "raw");
        if (rawAssets.length !== RAW_SAMPLES.length) {
          throw new Error(`Expected ${RAW_SAMPLES.length} RAW assets, got ${rawAssets.length}`);
        }
        for (const rawAsset of rawAssets) {
          if (rawAsset.previewKind !== "raw_embedded") {
            throw new Error(`Expected raw_embedded RAW for ${rawAsset.name}, got ${rawAsset.previewKind}`);
          }
        }

        const exportItems: NonNullable<ExportJobRecord["items"]> = [];
        for (let index = 0; index < mixedAssets.length; index += 1) {
          const asset = mixedAssets[index];
          const requestedName = createExportName(asset, EXPORT_COUNT + index);
          const saved = await saveExportFile(
            report.summary.outputDir as string,
            requestedName,
            await renderDiagnosticExport(asset),
            exportSettings.conflictStrategy
          );
          report.writtenFiles.push({ name: saved.fileName, path: saved.path, skipped: saved.skipped });
          exportItems.push({
            assetId: asset.id,
            name: asset.name,
            status: saved.skipped ? "skipped" : "written",
            requestedName,
            outputName: saved.fileName,
            outputPath: saved.path
          });
          if (!saved.skipped) report.summary.mixedWrittenCount += 1;
          if (asset.sourceFormat === "raw" && !saved.skipped && saved.fileName.toLowerCase().endsWith(".jpg")) {
            report.summary.mixedRawWrittenCount += 1;
          }
        }

        if (report.summary.mixedWrittenCount !== MIXED_EXPORT_COUNT) {
          throw new Error(`Expected ${MIXED_EXPORT_COUNT} mixed writes, got ${report.summary.mixedWrittenCount}`);
        }
        report.summary.mixedRawWritten = report.summary.mixedRawWrittenCount === RAW_SAMPLES.length;
        if (!report.summary.mixedRawWritten) {
          throw new Error(`Expected ${RAW_SAMPLES.length} RAW embedded preview JPG writes, got ${report.summary.mixedRawWrittenCount}`);
        }

        await recordExportJob({
          mode: "batch",
          status: "completed",
          totalCount: MIXED_EXPORT_COUNT,
          completedCount: report.summary.mixedWrittenCount,
          failedCount: 0,
          outputDir: report.summary.outputDir,
          items: exportItems,
          failed: []
        });
        const history = await listExportJobs(1);
        const latest = history[0];
        if (!latest || latest.status !== "completed" || latest.completedCount !== MIXED_EXPORT_COUNT) {
          throw new Error("Export history did not include the latest mixed diagnostic job");
        }
        report.summary.mixedHistoryVerified = true;
        return `mixed exports written: ${exportItems.map((item) => item.outputName).join(", ")}`;
      });

      report.summary.status = "passed";
    }
  } catch {
    report.summary.status = "failed";
    report.summary.failedCount += 1;
  } finally {
    cleanupAssets(assets);
    report.finishedAt = new Date().toISOString();
    report.totalDurationMs = now() - started;
    if (isTauriRuntime() && report.summary.status !== "skipped") {
      try {
        const savedPath = await saveDiagnosticReport("phase5-export", report);
        if (savedPath) report.savedReportPath = savedPath;
      } catch (error) {
        report.summary.status = "failed";
        report.summary.failedCount += 1;
        report.steps.push({
          name: "save export diagnostic report",
          status: "failed",
          durationMs: 0,
          detail: error instanceof Error ? error.message : String(error)
        });
      }
    }
    renderReport(report);
  }

  return report;
};
