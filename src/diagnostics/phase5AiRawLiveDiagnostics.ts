import { createDefaultEditParams } from "../services/editParams";
import {
  isTauriRuntime,
  readPhotoFiles,
  saveDiagnosticReport,
  tunePhotoWithAi
} from "../services/desktopBridge";
import { desktopPhotoPayloadToFile } from "../services/desktopImportPayload";
import { calculateFileHash, importPhotoFile } from "../services/imageProcessing";
import type { AiTuningMode } from "../types";

interface AiRawLiveStep {
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  detail: string;
}

interface AiRawLiveReport {
  startedAt: string;
  finishedAt?: string;
  totalDurationMs?: number;
  savedReportPath?: string;
  status: "running" | "passed" | "failed" | "skipped";
  steps: AiRawLiveStep[];
  summary: {
    isTauri: boolean;
    sampleConfigured: boolean;
    sourceFormat?: string;
    cameraBrand?: string;
    previewKind?: string;
    previewDataUrlBytes?: number;
    mode: AiTuningMode;
    referenceConfigured: boolean;
    referenceSourceFormat?: string;
    referenceCameraBrand?: string;
    referencePreviewKind?: string;
    referenceDataUrlBytes?: number;
    aiStatus?: "passed" | "failed";
    model?: string;
    paramCount?: number;
    paramKeys: string[];
    privacyPassed: boolean;
  };
  result?: {
    model: string;
    summary: string;
    paramKeys: string[];
    paramsPreview: Record<string, number>;
  };
  notes: string[];
}

declare global {
  interface Window {
    __AUTO_PHOTO_PHASE5_AI_RAW_LIVE_DIAGNOSTICS__?: AiRawLiveReport;
  }
}

const now = () => performance.now();
const defaultSamplePath = "C:\\Users\\Administrator\\Desktop\\auto_photo\\image\\nikon\\DSC_2156.NEF";
const defaultReferencePath =
  "C:\\Users\\Administrator\\Desktop\\auto_photo\\image\\generated-jpg\\sony-20230813-0192-embedded.jpg";
const configuredSamplePath = (import.meta.env.VITE_AUTO_PHOTO_RAW_AI_SAMPLE_PATH ?? defaultSamplePath).trim();
const configuredReferencePath = (import.meta.env.VITE_AUTO_PHOTO_RAW_AI_REFERENCE_PATH ?? defaultReferencePath).trim();
const expectedBrand = (import.meta.env.VITE_AUTO_PHOTO_RAW_AI_EXPECTED_BRAND ?? "Nikon").trim();
const sampleFileName = configuredSamplePath.split(/[\\/]/).pop() ?? "RAW-sample";
const tuningMode: AiTuningMode =
  (import.meta.env.VITE_AUTO_PHOTO_RAW_AI_MODE ?? "autoColor").trim() === "styleMatch" ? "styleMatch" : "autoColor";
const allowedParamKeys = new Set([
  "exposure",
  "temperature",
  "tint",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "clarity",
  "texture",
  "dehaze",
  "vibrance",
  "saturation",
  "sharpen",
  "noiseReduction",
  "vignette",
  "grain",
  "skinSmooth",
  "skinTone",
  "hsl"
]);

const sanitizeDiagnosticText = (value: unknown) =>
  String(value ?? "")
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, "[redacted-image-data]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, "sk-[redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .slice(0, 420);

const escapeHtml = (value: unknown) =>
  sanitizeDiagnosticText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const assertPrivacy = (report: AiRawLiveReport) => {
  const text = JSON.stringify({
    steps: report.steps,
    summary: report.summary,
    result: report.result,
    notes: report.notes
  });
  return !/(https?:\/\/|Bearer\s+|sk-[A-Za-z0-9_-]{8,}|data:image\/[^;]+;base64,)/i.test(text);
};

const renderReport = (report: AiRawLiveReport) => {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");
  document.documentElement.dataset.phase5AiRawLiveStatus = report.status;
  document.documentElement.dataset.phase5AiRawLiveAi = report.summary.aiStatus ?? "";
  document.documentElement.dataset.phase5AiRawLivePrivacy = String(report.summary.privacyPassed);
  document.documentElement.dataset.phase5AiRawLiveParamCount = String(report.summary.paramCount ?? 0);

  const rows = report.steps
    .map(
      (step) =>
        `<tr><td>${escapeHtml(step.status)}</td><td>${escapeHtml(step.name)}</td><td>${Math.round(step.durationMs)} ms</td><td>${escapeHtml(step.detail)}</td></tr>`
    )
    .join("");
  root.innerHTML = `
    <main style="max-width:980px;margin:0 auto;padding:24px;font-family:Segoe UI,Arial,sans-serif;color:#17202a">
      <h1 style="margin:0 0 8px;font-size:26px">Phase 5 RAW AI Live Diagnostics</h1>
      <p>Status: <strong>${escapeHtml(report.status)}</strong></p>
      <section style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0">
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Tauri<br><strong>${report.summary.isTauri ? "yes" : "no"}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">RAW<br><strong>${escapeHtml(report.summary.cameraBrand ?? "n/a")}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Preview<br><strong>${escapeHtml(report.summary.previewKind ?? "n/a")}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">AI Params<br><strong>${escapeHtml(report.summary.paramCount ?? 0)}</strong></div>
      </section>
      <p style="color:#53616f">Mode ${escapeHtml(report.summary.mode)} / AI ${escapeHtml(report.summary.aiStatus ?? "n/a")} / model ${escapeHtml(report.summary.model ?? "n/a")} / privacy ${escapeHtml(String(report.summary.privacyPassed))}</p>
      <p style="color:#53616f">Param keys: ${escapeHtml(report.summary.paramKeys.join(", ") || "n/a")}</p>
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
    element.style.verticalAlign = "top";
  });
};

const runStep = async (report: AiRawLiveReport, name: string, run: () => Promise<string>, skipped = false) => {
  const started = now();
  try {
    const detail = await run();
    report.steps.push({ name, status: skipped ? "skipped" : "passed", durationMs: now() - started, detail });
  } catch (error) {
    report.steps.push({
      name,
      status: "failed",
      durationMs: now() - started,
      detail: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error))
    });
    throw error;
  } finally {
    report.summary.privacyPassed = assertPrivacy(report);
    renderReport(report);
  }
};

const numericParamsPreview = (params: Record<string, unknown>) => {
  const preview: Record<string, number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "number" && Number.isFinite(value)) preview[key] = value;
  }
  return preview;
};

export const runPhase5AiRawLiveDiagnostics = async () => {
  const started = now();
  const report: AiRawLiveReport = {
    startedAt: new Date().toISOString(),
    status: "running",
    steps: [],
    summary: {
      isTauri: isTauriRuntime(),
      sampleConfigured: Boolean(configuredSamplePath),
      mode: tuningMode,
      referenceConfigured: tuningMode === "styleMatch" && Boolean(configuredReferencePath),
      paramKeys: [],
      privacyPassed: true
    },
    notes: [
      "This diagnostics sends only the RAW embedded preview data URL to the existing AI tuning command.",
      "It does not read openAi.json and does not print or save API keys, Base URLs, authorization tokens, remote response bodies or image data URLs.",
      "The saved report keeps only sanitized status, model, RAW metadata category, parameter keys and numeric parameter preview."
    ]
  };
  window.__AUTO_PHOTO_PHASE5_AI_RAW_LIVE_DIAGNOSTICS__ = report;
  renderReport(report);

  let imageDataUrl = "";
  let referenceDataUrl = "";
  let cameraSummary = `${expectedBrand} RAW embedded preview`;

  try {
    if (!isTauriRuntime()) {
      await runStep(report, "skip outside Tauri runtime", async () => "RAW AI live diagnostics require Tauri runtime.", true);
      report.status = "skipped";
      return report;
    }

    await runStep(report, "read RAW sample and extract embedded preview", async () => {
      const samples = await readPhotoFiles([configuredSamplePath]);
      if (samples.length !== 1) throw new Error(`Expected one RAW sample, got ${samples.length}`);
      const file = desktopPhotoPayloadToFile(samples[0], { lastModified: 1_788_800_000_000 });
      const asset = await importPhotoFile(file, await calculateFileHash(file));
      report.summary.sourceFormat = asset.sourceFormat;
      report.summary.cameraBrand = asset.cameraBrand;
      report.summary.previewKind = asset.previewKind;
      if (asset.sourceFormat !== "raw") throw new Error(`Expected RAW asset, got ${asset.sourceFormat}`);
      if (expectedBrand && asset.cameraBrand !== expectedBrand) {
        throw new Error(`Expected ${expectedBrand} RAW, got ${asset.cameraBrand}`);
      }
      if (asset.previewKind !== "raw_embedded") throw new Error(`Expected RAW embedded preview, got ${asset.previewKind}`);
      if (!asset.previewUrl.startsWith("data:image/jpeg;base64,")) throw new Error("RAW embedded preview is not a JPG data URL");
      imageDataUrl = asset.previewUrl;
      report.summary.previewDataUrlBytes = imageDataUrl.length;
      cameraSummary = `${asset.cameraBrand} ${asset.metadata.model ?? "RAW"} ${asset.metadata.lens ?? ""}`.trim();
      return `${asset.cameraBrand} RAW embedded preview prepared (${imageDataUrl.length} chars)`;
    });

    if (tuningMode === "styleMatch") {
      await runStep(report, "read reference photo preview for AI style match", async () => {
        const samples = await readPhotoFiles([configuredReferencePath]);
        if (samples.length !== 1) throw new Error(`Expected one reference sample, got ${samples.length}`);
        const file = desktopPhotoPayloadToFile(samples[0], { lastModified: 1_788_800_000_000 });
        const asset = await importPhotoFile(file, await calculateFileHash(file));
        report.summary.referenceSourceFormat = asset.sourceFormat;
        report.summary.referenceCameraBrand = asset.cameraBrand;
        report.summary.referencePreviewKind = asset.previewKind;
        if (!asset.previewUrl.startsWith("data:image/jpeg;base64,")) {
          throw new Error("Reference preview is not a JPG data URL");
        }
        referenceDataUrl = asset.previewUrl;
        report.summary.referenceDataUrlBytes = referenceDataUrl.length;
        return `${asset.sourceFormat} reference preview prepared (${referenceDataUrl.length} chars)`;
      });
    }

    await runStep(report, "request AI tuning for RAW embedded preview", async () => {
      const result = await tunePhotoWithAi({
        mode: tuningMode,
        assetName: sampleFileName,
        cameraSummary,
        imageDataUrl,
        referenceDataUrl: tuningMode === "styleMatch" ? referenceDataUrl : undefined,
        userInstruction:
          tuningMode === "styleMatch"
            ? `请让 ${expectedBrand} RAW 内嵌预览接近参考图的整体色彩和氛围，但保持自然不过度。`
            : `请给出自然、不过度的 ${expectedBrand} RAW 内嵌预览级调色参数。`,
        currentParams: createDefaultEditParams()
      });
      const params = result.params as Record<string, unknown>;
      const paramKeys = Object.keys(params).filter((key) => allowedParamKeys.has(key)).sort();
      const paramsPreview = numericParamsPreview(params);
      if (paramKeys.length === 0 && Object.keys(paramsPreview).length === 0) {
        throw new Error("AI returned no recognized tuning parameter fields");
      }
      report.summary.aiStatus = "passed";
      report.summary.model = sanitizeDiagnosticText(result.model);
      report.summary.paramKeys = paramKeys;
      report.summary.paramCount = paramKeys.length;
      report.result = {
        model: sanitizeDiagnosticText(result.model),
        summary: sanitizeDiagnosticText(result.summary),
        paramKeys,
        paramsPreview
      };
      report.summary.privacyPassed = assertPrivacy(report);
      if (!report.summary.privacyPassed) throw new Error("Sanitized RAW AI report still contains secret-looking content");
      return `AI returned ${paramKeys.length} recognized parameter field(s)`;
    });

    report.status = "passed";
  } catch {
    if (!report.summary.aiStatus) report.summary.aiStatus = "failed";
    report.status = "failed";
  } finally {
    imageDataUrl = "";
    referenceDataUrl = "";
    report.finishedAt = new Date().toISOString();
    report.totalDurationMs = now() - started;
    report.summary.privacyPassed = assertPrivacy(report);
    if (isTauriRuntime() && report.status !== "skipped") {
      try {
        const savedPath = await saveDiagnosticReport("phase5-ai-raw-live", report);
        if (savedPath) report.savedReportPath = savedPath;
      } catch (error) {
        report.status = "failed";
        report.steps.push({
          name: "save RAW AI live diagnostic report",
          status: "failed",
          durationMs: 0,
          detail: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error))
        });
      }
    }
    renderReport(report);
  }

  return report;
};
