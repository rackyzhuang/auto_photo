import {
  getProcessResourceSample,
  isTauriRuntime,
  readPhotoFiles,
  runKeyringDiagnostic,
  saveDiagnosticReport,
  type DiagnosticSampleFile
} from "../services/desktopBridge";
import { desktopPhotoPayloadToFile } from "../services/desktopImportPayload";
import { calculateFileHash, importPhotoFile } from "../services/imageProcessing";
import type { CameraBrand, KeyringDiagnosticReport, PhotoAsset, PreviewKind, ProcessResourceSample, SourceFormat } from "../types";

interface DesktopDiagnosticStep {
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  detail: string;
}

interface DesktopDiagnosticReport {
  startedAt: string;
  finishedAt?: string;
  totalDurationMs?: number;
  savedReportPath?: string;
  status: "running" | "passed" | "failed" | "skipped";
  steps: DesktopDiagnosticStep[];
  summary: {
    isTauri: boolean;
    keyringStatus?: "passed" | "failed";
    keyringWriteSucceeded?: boolean;
    keyringReadSucceeded?: boolean;
    keyringDeleteSucceeded?: boolean;
    keyringMissingAfterDelete?: boolean;
    aiKeyPresenceUnchanged?: boolean;
    processSampleCaptured: boolean;
    desktopImportConfigured: boolean;
    desktopImportReadCount: number;
    desktopImportImportedCount: number;
    desktopImportJpgCount: number;
    desktopImportRawCount: number;
    desktopImportNikonCount: number;
    desktopImportSonyCount: number;
    desktopImportEmbeddedRawCount: number;
    workingSetBytes?: number;
    privateMemoryBytes?: number;
  };
  keyring?: KeyringDiagnosticReport;
  processSample?: ProcessResourceSample;
  desktopImports: DesktopImportItem[];
  notes: string[];
}

interface DesktopImportItem {
  name: string;
  path?: string;
  size: number;
  sourceFormat?: SourceFormat;
  previewKind?: PreviewKind;
  cameraBrand?: CameraBrand;
  isEditable?: boolean;
  status: "passed" | "failed";
  detail: string;
}

declare global {
  interface Window {
    __AUTO_PHOTO_PHASE5_DESKTOP_DIAGNOSTICS__?: DesktopDiagnosticReport;
  }
}

const now = () => performance.now();
const configuredDesktopImportPaths = (import.meta.env.VITE_AUTO_PHOTO_DESKTOP_IMPORT_PATHS ?? "")
  .split(";")
  .map((path: string) => path.trim())
  .filter(Boolean);

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderReport = (report: DesktopDiagnosticReport) => {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");
  document.documentElement.dataset.phase5DesktopStatus = report.status;
  document.documentElement.dataset.phase5DesktopKeyring = report.summary.keyringStatus ?? "";
  document.documentElement.dataset.phase5DesktopProcess = String(report.summary.processSampleCaptured);

  const rows = report.steps
    .map(
      (step) =>
        `<tr><td>${escapeHtml(step.status)}</td><td>${escapeHtml(step.name)}</td><td>${Math.round(step.durationMs)} ms</td><td>${escapeHtml(step.detail)}</td></tr>`
    )
    .join("");
  root.innerHTML = `
    <main style="max-width:980px;margin:0 auto;padding:24px;font-family:Segoe UI,Arial,sans-serif;color:#17202a">
      <h1 style="margin:0 0 8px;font-size:26px">Phase 5 Desktop Diagnostics</h1>
      <p>Status: <strong>${escapeHtml(report.status)}</strong></p>
      <section style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0">
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Tauri<br><strong>${report.summary.isTauri ? "yes" : "no"}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Keyring<br><strong>${escapeHtml(report.summary.keyringStatus ?? "n/a")}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Process<br><strong>${report.summary.processSampleCaptured ? "captured" : "n/a"}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Desktop Import<br><strong>${report.summary.desktopImportImportedCount}/${report.summary.desktopImportReadCount}</strong></div>
      </section>
      <p style="color:#53616f">JPG ${report.summary.desktopImportJpgCount} / RAW ${report.summary.desktopImportRawCount} / Nikon ${report.summary.desktopImportNikonCount} / Sony ${report.summary.desktopImportSonyCount} / RAW embedded ${report.summary.desktopImportEmbeddedRawCount}</p>
      <ul style="color:#53616f">${report.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
      ${report.savedReportPath ? `<p style="word-break:break-all;color:#53616f">Saved report: ${escapeHtml(report.savedReportPath)}</p>` : ""}
      <table style="width:100%;border-collapse:collapse;background:white;border:1px solid #dfe4ea"><tbody>${rows}</tbody></table>
    </main>
  `;
  root.querySelectorAll("td").forEach((cell) => {
    const element = cell as HTMLElement;
    element.style.borderTop = "1px solid #edf0f3";
    element.style.padding = "8px 10px";
    element.style.fontSize = "13px";
  });
};

const runStep = async (
  report: DesktopDiagnosticReport,
  name: string,
  run: () => Promise<string>,
  skipped = false
) => {
  const started = now();
  try {
    const detail = await run();
    report.steps.push({ name, status: skipped ? "skipped" : "passed", durationMs: now() - started, detail });
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

const summarizeDesktopImport = (asset: PhotoAsset, sample: DiagnosticSampleFile): DesktopImportItem => ({
  name: asset.name,
  path: sample.path,
  size: asset.size,
  sourceFormat: asset.sourceFormat,
  previewKind: asset.previewKind,
  cameraBrand: asset.cameraBrand,
  isEditable: asset.isEditable,
  status: "passed",
  detail: asset.sourceFormat === "raw" ? `${asset.previewKind} ${asset.cameraBrand}` : "editable JPG"
});

const applyDesktopImportSummary = (report: DesktopDiagnosticReport) => {
  report.summary.desktopImportImportedCount = report.desktopImports.filter((item) => item.status === "passed").length;
  report.summary.desktopImportJpgCount = report.desktopImports.filter((item) => item.sourceFormat === "jpg").length;
  report.summary.desktopImportRawCount = report.desktopImports.filter((item) => item.sourceFormat === "raw").length;
  report.summary.desktopImportNikonCount = report.desktopImports.filter((item) => item.cameraBrand === "Nikon").length;
  report.summary.desktopImportSonyCount = report.desktopImports.filter((item) => item.cameraBrand === "Sony").length;
  report.summary.desktopImportEmbeddedRawCount = report.desktopImports.filter((item) => item.previewKind === "raw_embedded").length;
};

export const runPhase5DesktopDiagnostics = async () => {
  const started = now();
  const report: DesktopDiagnosticReport = {
    startedAt: new Date().toISOString(),
    status: "running",
    steps: [],
    summary: {
      isTauri: isTauriRuntime(),
      processSampleCaptured: false,
      desktopImportConfigured: configuredDesktopImportPaths.length > 0,
      desktopImportReadCount: 0,
      desktopImportImportedCount: 0,
      desktopImportJpgCount: 0,
      desktopImportRawCount: 0,
      desktopImportNikonCount: 0,
      desktopImportSonyCount: 0,
      desktopImportEmbeddedRawCount: 0
    },
    desktopImports: [],
    notes: [
      "This diagnostics uses an isolated non-production keyring entry.",
      "It does not read, print, save or export any AI API key, private URL or openAi.json content.",
      "The product AI key entry is not overwritten.",
      "Set VITE_AUTO_PHOTO_DESKTOP_IMPORT_PATHS to semicolon-separated JPG/NEF/ARW paths to verify desktop import."
    ]
  };
  window.__AUTO_PHOTO_PHASE5_DESKTOP_DIAGNOSTICS__ = report;
  renderReport(report);

  try {
    if (!isTauriRuntime()) {
      await runStep(report, "skip outside Tauri runtime", async () => "Desktop diagnostics require Tauri runtime.", true);
      report.status = "skipped";
      return report;
    }

    await runStep(report, "capture process resource sample", async () => {
      const sample = await getProcessResourceSample();
      if (!sample) throw new Error("Process sample unavailable");
      report.processSample = sample;
      report.summary.processSampleCaptured = true;
      report.summary.workingSetBytes = sample.workingSetBytes;
      report.summary.privateMemoryBytes = sample.privateMemoryBytes;
      return `pid=${sample.pid}, platform=${sample.platform}`;
    });

    await runStep(report, "run isolated keyring smoke test", async () => {
      const keyring = await runKeyringDiagnostic();
      if (!keyring) throw new Error("Keyring diagnostic unavailable");
      report.keyring = keyring;
      report.summary.keyringStatus = keyring.status;
      report.summary.keyringWriteSucceeded = keyring.writeSucceeded;
      report.summary.keyringReadSucceeded = keyring.readSucceeded;
      report.summary.keyringDeleteSucceeded = keyring.deleteSucceeded;
      report.summary.keyringMissingAfterDelete = keyring.missingAfterDelete;
      report.summary.aiKeyPresenceUnchanged = keyring.aiKeyPresenceUnchanged;
      if (keyring.status !== "passed") throw new Error("Keyring smoke test failed");
      return "isolated keyring entry round-tripped and was deleted";
    });

    if (configuredDesktopImportPaths.length === 0) {
      await runStep(
        report,
        "skip desktop import sample paths",
        async () => "Set VITE_AUTO_PHOTO_DESKTOP_IMPORT_PATHS to verify real desktop JPG/RAW imports.",
        true
      );
    } else {
      await runStep(report, "read and import configured desktop photo paths", async () => {
        const samples = await readPhotoFiles(configuredDesktopImportPaths);
        report.summary.desktopImportReadCount = samples.length;
        if (samples.length !== configuredDesktopImportPaths.length) {
          throw new Error(`Expected ${configuredDesktopImportPaths.length} desktop files, got ${samples.length}`);
        }

        for (const sample of samples) {
          try {
            const file = desktopPhotoPayloadToFile(sample, { lastModified: 1_788_800_000_000 });
            const asset = await importPhotoFile(file, await calculateFileHash(file));
            report.desktopImports.push(summarizeDesktopImport(asset, sample));
          } catch (error) {
            report.desktopImports.push({
              name: sample.name,
              path: sample.path,
              size: sample.size,
              status: "failed",
              detail: error instanceof Error ? error.message : String(error)
            });
          }
        }

        applyDesktopImportSummary(report);
        const failed = report.desktopImports.filter((item) => item.status === "failed");
        if (failed.length > 0) throw new Error(`Desktop import failed for ${failed.length} file(s)`);
        if (report.summary.desktopImportJpgCount < 1) throw new Error("Expected at least one JPG desktop import");
        if (report.summary.desktopImportRawCount < 1) throw new Error("Expected at least one RAW desktop import");
        if (report.summary.desktopImportNikonCount < 1) throw new Error("Expected at least one Nikon desktop import");
        if (report.summary.desktopImportSonyCount < 1) throw new Error("Expected at least one Sony desktop import");
        if (report.summary.desktopImportEmbeddedRawCount < 1) throw new Error("Expected at least one RAW embedded preview");
        return `imported ${report.summary.desktopImportImportedCount} desktop files`;
      });
    }

    report.status = "passed";
  } catch {
    report.status = "failed";
  } finally {
    report.finishedAt = new Date().toISOString();
    report.totalDurationMs = now() - started;
    if (isTauriRuntime() && report.status !== "skipped") {
      try {
        const savedPath = await saveDiagnosticReport("phase5-desktop", report);
        if (savedPath) report.savedReportPath = savedPath;
      } catch (error) {
        report.status = "failed";
        report.steps.push({
          name: "save desktop diagnostic report",
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
