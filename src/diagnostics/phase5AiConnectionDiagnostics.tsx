import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "../App";
import type { AiConnectionDiagnostic, AiSettingsState } from "../types";

interface AiConnectionStep {
  name: string;
  status: "passed" | "failed";
  durationMs: number;
  detail: string;
}

interface AiConnectionReport {
  startedAt: string;
  finishedAt?: string;
  totalDurationMs?: number;
  steps: AiConnectionStep[];
  summary: {
    status: "running" | "passed" | "failed";
    settingsInjected: boolean;
    passedRendered: boolean;
    failedRendered: boolean;
    privacyPassed: boolean;
    layoutPassed: boolean;
  };
}

declare global {
  interface Window {
    __AUTO_PHOTO_PHASE5_AI_CONNECTION_DIAGNOSTICS__?: AiConnectionReport;
    __AUTO_PHOTO_INJECT_AI_SETTINGS__?: (settings: AiSettingsState, editing?: boolean) => void;
    __AUTO_PHOTO_INJECT_AI_CONNECTION_DIAGNOSTIC__?: (diagnostic: AiConnectionDiagnostic) => void;
  }
}

const now = () => performance.now();
const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const waitFor = async (check: () => boolean, label: string, timeoutMs = 12000) => {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (check()) return;
    await delay(60);
  }
  throw new Error(`Timed out waiting for ${label}`);
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
      0.9
    );
  });

const createSyntheticJpg = async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 640;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create synthetic JPG");
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "hsl(204, 55%, 70%)");
  gradient.addColorStop(0.48, "hsl(38, 44%, 52%)");
  gradient.addColorStop(1, "hsl(222, 34%, 24%)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fillRect(canvas.width * 0.58, 88, 220, 430);
  ctx.fillStyle = "rgba(20,28,36,0.34)";
  ctx.font = '700 34px "Segoe UI", sans-serif';
  ctx.fillText("AI-CONNECTION", 36, canvas.height - 42);
  return canvasToFile(canvas, "phase5-ai-connection-reference.jpg");
};

const setInputFiles = (input: HTMLInputElement, files: File[]) => {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

const renderOverlay = (report: AiConnectionReport) => {
  let overlay = document.getElementById("phase5-ai-connection-diagnostics");
  if (!overlay) {
    overlay = document.createElement("section");
    overlay.id = "phase5-ai-connection-diagnostics";
    overlay.style.position = "fixed";
    overlay.style.left = "12px";
    overlay.style.bottom = "12px";
    overlay.style.zIndex = "9999";
    overlay.style.width = "560px";
    overlay.style.maxHeight = "52vh";
    overlay.style.overflow = "auto";
    overlay.style.padding = "12px";
    overlay.style.background = "rgba(255,255,255,0.96)";
    overlay.style.border = "1px solid #ccd3db";
    overlay.style.boxShadow = "0 8px 28px rgba(0,0,0,0.16)";
    overlay.style.font = '12px/1.45 "Segoe UI", sans-serif';
    document.body.appendChild(overlay);
  }

  document.documentElement.dataset.phase5AiConnectionStatus = report.summary.status;
  document.documentElement.dataset.phase5AiConnectionPassed = String(report.summary.passedRendered);
  document.documentElement.dataset.phase5AiConnectionFailed = String(report.summary.failedRendered);
  document.documentElement.dataset.phase5AiConnectionPrivacy = String(report.summary.privacyPassed);
  document.documentElement.dataset.phase5AiConnectionLayout = String(report.summary.layoutPassed);

  const rows = report.steps
    .map((step) => `<tr><td>${step.status}</td><td>${step.name}</td><td>${Math.round(step.durationMs)} ms</td><td>${step.detail}</td></tr>`)
    .join("");
  overlay.innerHTML = `
    <strong>Phase 5 AI Connection Diagnostics: ${report.summary.status}</strong>
    <div>Settings ${report.summary.settingsInjected} / Passed ${report.summary.passedRendered} / Failed ${report.summary.failedRendered} / Privacy ${report.summary.privacyPassed} / Layout ${report.summary.layoutPassed}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:8px"><tbody>${rows}</tbody></table>
  `;
  overlay.querySelectorAll("td").forEach((cell) => {
    const element = cell as HTMLElement;
    element.style.borderTop = "1px solid #e4e8ec";
    element.style.padding = "4px 6px";
    element.style.verticalAlign = "top";
  });
};

const runStep = async (report: AiConnectionReport, name: string, action: () => Promise<string> | string) => {
  const started = now();
  try {
    const detail = await action();
    report.steps.push({ name, status: "passed", durationMs: now() - started, detail });
  } catch (error) {
    report.steps.push({
      name,
      status: "failed",
      durationMs: now() - started,
      detail: error instanceof Error ? error.message : String(error)
    });
    report.summary.status = "failed";
    throw error;
  } finally {
    renderOverlay(report);
  }
};

const openAccordion = async (testId: string) => {
  const trigger = document.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;
  if (!trigger) throw new Error(`${testId} not found`);
  if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
  await waitFor(() => trigger.getAttribute("aria-expanded") === "true", `${testId} open`);
};

const assertDiagnosticResult = (expectedStatus: "passed" | "failed") => {
  const diagnostic = document.querySelector('[data-testid="ai-connection-diagnostic"]') as HTMLElement | null;
  if (!diagnostic) throw new Error("AI connection diagnostic result not found");
  if (!diagnostic.classList.contains(expectedStatus)) {
    throw new Error(`Expected ${expectedStatus} diagnostic result`);
  }
  if (diagnostic.scrollWidth > diagnostic.clientWidth + 2) {
    throw new Error(`AI connection diagnostic overflow: ${diagnostic.scrollWidth} > ${diagnostic.clientWidth}`);
  }
  const text = diagnostic.textContent ?? "";
  if (!text.includes("模型") || !text.includes("个模型")) {
    throw new Error("AI connection diagnostic missing model labels");
  }
  if (text.includes("https://") || text.includes("Bearer ") || /sk-[A-Za-z0-9]{12,}/.test(text)) {
    throw new Error("AI connection diagnostic leaked secret-looking content");
  }
  return text;
};

export const runPhase5AiConnectionDiagnostics = async () => {
  const report: AiConnectionReport = {
    startedAt: new Date().toISOString(),
    steps: [],
    summary: {
      status: "running",
      settingsInjected: false,
      passedRendered: false,
      failedRendered: false,
      privacyPassed: false,
      layoutPassed: false
    }
  };
  window.__AUTO_PHOTO_PHASE5_AI_CONNECTION_DIAGNOSTICS__ = report;
  renderOverlay(report);

  const started = now();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

  try {
    await runStep(report, "import synthetic JPG for AI panel", async () => {
      await waitFor(() => Boolean(document.querySelector('[data-testid="photo-import-input"]')), "import input");
      const input = document.querySelector('[data-testid="photo-import-input"]') as HTMLInputElement | null;
      if (!input) throw new Error("Import input not found");
      setInputFiles(input, [await createSyntheticJpg()]);
      await waitFor(() => document.querySelectorAll(".asset-row").length >= 1, "imported JPG row", 30000);
      return "Synthetic JPG imported so the right-side AI panel is mounted";
    });

    await runStep(report, "inject safe AI settings", async () => {
      await openAccordion("accordion-ai-trigger");
      await waitFor(() => typeof window.__AUTO_PHOTO_INJECT_AI_SETTINGS__ === "function", "AI settings injection");
      window.__AUTO_PHOTO_INJECT_AI_SETTINGS__?.(
        {
          model: "diagnostic-model",
          baseUrl: "https://example.test/v1/models?api_key=must-not-show#secret",
          hasApiKey: true,
          availableModels: ["diagnostic-model", "alternate-model"]
        },
        false
      );
      await waitFor(() => Boolean(document.querySelector('[data-testid="ai-model-select"]')), "AI model select");
      report.summary.settingsInjected = true;
      return "AI settings injected without showing key/base URL fields";
    });

    await runStep(report, "render passed connection diagnostic", async () => {
      await waitFor(
        () => typeof window.__AUTO_PHOTO_INJECT_AI_CONNECTION_DIAGNOSTIC__ === "function",
        "AI connection diagnostic injection"
      );
      window.__AUTO_PHOTO_INJECT_AI_CONNECTION_DIAGNOSTIC__?.({
        status: "passed",
        hasApiKey: true,
        model: "diagnostic-model",
        modelAvailable: true,
        modelCount: 2,
        message: "AI 连接诊断通过：已获取 2 个模型，当前模型可用。"
      });
      await waitFor(() => Boolean(document.querySelector('[data-testid="ai-connection-diagnostic"].passed')), "passed diagnostic");
      const text = assertDiagnosticResult("passed");
      report.summary.passedRendered = true;
      return text;
    });

    await runStep(report, "render failed connection diagnostic safely", async () => {
      window.__AUTO_PHOTO_INJECT_AI_CONNECTION_DIAGNOSTIC__?.({
        status: "failed",
        hasApiKey: true,
        model: "diagnostic-missing-model",
        modelAvailable: false,
        modelCount: 1,
        message:
          "AI 连接诊断通过：已获取 1 个模型，但当前模型不在模型列表中，请切换可用模型。这段长消息用于确认诊断结果区不会横向溢出，也不会展示私有地址或密钥。"
      });
      await waitFor(() => Boolean(document.querySelector('[data-testid="ai-connection-diagnostic"].failed')), "failed diagnostic");
      const text = assertDiagnosticResult("failed");
      report.summary.failedRendered = true;
      report.summary.privacyPassed = true;
      report.summary.layoutPassed = true;
      return text;
    });

    report.summary.status = "passed";
  } catch {
    report.summary.status = "failed";
  } finally {
    report.finishedAt = new Date().toISOString();
    report.totalDurationMs = now() - started;
    renderOverlay(report);
  }
};
