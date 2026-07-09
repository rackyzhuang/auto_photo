import { diagnoseAiConnection, isTauriRuntime, saveDiagnosticReport } from "../services/desktopBridge";
import type { AiConnectionDiagnostic } from "../types";

interface AiLiveStep {
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  detail: string;
}

interface AiLiveReport {
  startedAt: string;
  finishedAt?: string;
  totalDurationMs?: number;
  savedReportPath?: string;
  status: "running" | "passed" | "failed" | "skipped";
  steps: AiLiveStep[];
  summary: {
    isTauri: boolean;
    hasApiKey?: boolean;
    model?: string;
    modelAvailable?: boolean;
    modelCount?: number;
    diagnosticStatus?: "passed" | "failed";
    privacyPassed: boolean;
  };
  diagnostic?: AiConnectionDiagnostic;
  notes: string[];
}

declare global {
  interface Window {
    __AUTO_PHOTO_PHASE5_AI_LIVE_DIAGNOSTICS__?: AiLiveReport;
  }
}

const now = () => performance.now();

const sanitizeDiagnosticText = (value: unknown) =>
  String(value ?? "")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, "sk-[redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .slice(0, 360);

const escapeHtml = (value: unknown) =>
  sanitizeDiagnosticText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const assertPrivacy = (report: AiLiveReport) => {
  const text = JSON.stringify({
    steps: report.steps,
    summary: report.summary,
    diagnostic: report.diagnostic
  });
  return !/(https?:\/\/|Bearer\s+|sk-[A-Za-z0-9_-]{8,})/i.test(text);
};

const renderReport = (report: AiLiveReport) => {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");
  document.documentElement.dataset.phase5AiLiveStatus = report.status;
  document.documentElement.dataset.phase5AiLivePrivacy = String(report.summary.privacyPassed);
  document.documentElement.dataset.phase5AiLiveDiagnostic = report.summary.diagnosticStatus ?? "";

  const rows = report.steps
    .map(
      (step) =>
        `<tr><td>${escapeHtml(step.status)}</td><td>${escapeHtml(step.name)}</td><td>${Math.round(step.durationMs)} ms</td><td>${escapeHtml(step.detail)}</td></tr>`
    )
    .join("");
  root.innerHTML = `
    <main style="max-width:920px;margin:0 auto;padding:24px;font-family:Segoe UI,Arial,sans-serif;color:#17202a">
      <h1 style="margin:0 0 8px;font-size:26px">Phase 5 AI Live Diagnostics</h1>
      <p>Status: <strong>${escapeHtml(report.status)}</strong></p>
      <section style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0">
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Tauri<br><strong>${report.summary.isTauri ? "yes" : "no"}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Key<br><strong>${report.summary.hasApiKey ? "saved" : "missing"}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Model<br><strong>${escapeHtml(report.summary.model ?? "n/a")}</strong></div>
        <div style="background:white;border:1px solid #dfe4ea;padding:12px">Models<br><strong>${escapeHtml(report.summary.modelCount ?? "n/a")}</strong></div>
      </section>
      <p style="color:#53616f">Diagnostic ${escapeHtml(report.summary.diagnosticStatus ?? "n/a")} / model available ${escapeHtml(String(report.summary.modelAvailable ?? false))} / privacy ${escapeHtml(String(report.summary.privacyPassed))}</p>
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

const runStep = async (report: AiLiveReport, name: string, run: () => Promise<string>, skipped = false) => {
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

export const runPhase5AiLiveDiagnostics = async () => {
  const started = now();
  const report: AiLiveReport = {
    startedAt: new Date().toISOString(),
    status: "running",
    steps: [],
    summary: {
      isTauri: isTauriRuntime(),
      privacyPassed: true
    },
    notes: [
      "This diagnostics calls only the Tauri AI connection diagnostic command.",
      "It does not read openAi.json and does not print or save API keys, Base URLs, authorization tokens or remote response bodies.",
      "Only sanitized connection status, model availability and model count are saved."
    ]
  };
  window.__AUTO_PHOTO_PHASE5_AI_LIVE_DIAGNOSTICS__ = report;
  renderReport(report);

  try {
    if (!isTauriRuntime()) {
      await runStep(report, "skip outside Tauri runtime", async () => "AI live diagnostics require Tauri runtime.", true);
      report.status = "skipped";
      return report;
    }

    await runStep(report, "run sanitized AI connection diagnostic", async () => {
      const diagnostic = await diagnoseAiConnection();
      const sanitized: AiConnectionDiagnostic = {
        status: diagnostic.status,
        hasApiKey: diagnostic.hasApiKey,
        model: sanitizeDiagnosticText(diagnostic.model),
        modelAvailable: diagnostic.modelAvailable,
        modelCount: diagnostic.modelCount,
        message: sanitizeDiagnosticText(diagnostic.message)
      };
      report.diagnostic = sanitized;
      report.summary.hasApiKey = sanitized.hasApiKey;
      report.summary.model = sanitized.model;
      report.summary.modelAvailable = sanitized.modelAvailable;
      report.summary.modelCount = sanitized.modelCount;
      report.summary.diagnosticStatus = sanitized.status;
      report.summary.privacyPassed = assertPrivacy(report);
      if (!report.summary.privacyPassed) throw new Error("Sanitized AI diagnostic still contains secret-looking content");
      if (sanitized.status !== "passed") {
        throw new Error(sanitized.message);
      }
      return sanitized.message;
    });

    report.status = "passed";
  } catch {
    report.status = "failed";
  } finally {
    report.finishedAt = new Date().toISOString();
    report.totalDurationMs = now() - started;
    report.summary.privacyPassed = assertPrivacy(report);
    if (isTauriRuntime() && report.status !== "skipped") {
      try {
        const savedPath = await saveDiagnosticReport("phase5-ai-live", report);
        if (savedPath) report.savedReportPath = savedPath;
      } catch (error) {
        report.status = "failed";
        report.steps.push({
          name: "save AI live diagnostic report",
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
