import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "../App";
import type { AiSettingsState, AiTuningResult } from "../types";

interface AiRawDiagnosticStep {
  name: string;
  status: "passed" | "failed";
  durationMs: number;
  detail: string;
}

interface AiRawDiagnosticReport {
  startedAt: string;
  finishedAt?: string;
  totalDurationMs?: number;
  steps: AiRawDiagnosticStep[];
  summary: {
    status: "running" | "passed" | "failed";
    importedRows: number;
    modelOptions: number;
    aiConfigHidden: boolean;
    instructionPresent: boolean;
    rawReferenceReady: boolean;
    rawAiEnabled: boolean;
    rawStyleEnabled: boolean;
    rawCandidateApplied: boolean;
    rawManualEdited: boolean;
    rawPreviewExported: boolean;
  };
}

declare global {
  interface Window {
    __AUTO_PHOTO_PHASE5_AI_RAW_DIAGNOSTICS__?: AiRawDiagnosticReport;
    __AUTO_PHOTO_INJECT_AI_SETTINGS__?: (settings: AiSettingsState, editing?: boolean) => void;
    __AUTO_PHOTO_INJECT_AI_SUGGESTION__?: (result: Partial<AiTuningResult>) => Promise<AiTuningResult | undefined>;
  }
}

const now = () => performance.now();
const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const waitFor = async (check: () => boolean, label: string, timeoutMs = 15000) => {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (check()) return;
    await delay(60);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const renderOverlay = (report: AiRawDiagnosticReport) => {
  let overlay = document.getElementById("phase5-ai-raw-diagnostics");
  if (!overlay) {
    overlay = document.createElement("section");
    overlay.id = "phase5-ai-raw-diagnostics";
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

  document.documentElement.dataset.phase5AiRawStatus = report.summary.status;
  document.documentElement.dataset.phase5AiRawRows = String(report.summary.importedRows);
  document.documentElement.dataset.phase5AiRawModels = String(report.summary.modelOptions);
  document.documentElement.dataset.phase5AiRawCandidateApplied = String(report.summary.rawCandidateApplied);
  document.documentElement.dataset.phase5AiRawManualEdited = String(report.summary.rawManualEdited);
  document.documentElement.dataset.phase5AiRawPreviewExported = String(report.summary.rawPreviewExported);

  const rows = report.steps
    .map((step) => `<tr><td>${step.status}</td><td>${step.name}</td><td>${Math.round(step.durationMs)} ms</td><td>${step.detail}</td></tr>`)
    .join("");
  overlay.innerHTML = `
    <strong>Phase 5 AI RAW Diagnostics: ${report.summary.status}</strong>
    <div>Rows ${report.summary.importedRows} / Models ${report.summary.modelOptions} / Hidden ${report.summary.aiConfigHidden} / Instruction ${report.summary.instructionPresent} / RAW reference ${report.summary.rawReferenceReady} / RAW AI ${report.summary.rawAiEnabled} / RAW style ${report.summary.rawStyleEnabled} / Applied ${report.summary.rawCandidateApplied} / Manual ${report.summary.rawManualEdited} / Export ${report.summary.rawPreviewExported}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:8px"><tbody>${rows}</tbody></table>
  `;
  overlay.querySelectorAll("td").forEach((cell) => {
    const element = cell as HTMLElement;
    element.style.borderTop = "1px solid #e4e8ec";
    element.style.padding = "4px";
  });
};

const runStep = async (report: AiRawDiagnosticReport, name: string, run: () => Promise<string>) => {
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
  } finally {
    renderOverlay(report);
  }
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

const createSyntheticJpg = async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 820;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create reference JPG");
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "hsl(205, 60%, 70%)");
  gradient.addColorStop(0.55, "hsl(35, 46%, 50%)");
  gradient.addColorStop(1, "hsl(222, 38%, 24%)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255, 232, 205, 0.76)";
  ctx.beginPath();
  ctx.ellipse(canvas.width * 0.35, canvas.height * 0.48, 132, 162, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(canvas.width * 0.58, 130, 220, 520);
  return canvasToFile(canvas, "phase5-ai-reference.jpg");
};

const fetchRawFile = async () => {
  const response = await fetch("/image/nikon/DSC_2156.NEF");
  if (!response.ok) throw new Error(`RAW fetch failed: ${response.status} ${response.statusText}`);
  const blob = await response.blob();
  return new File([blob], "DSC_2156.NEF", { type: "image/x-nikon-nef", lastModified: 1_788_800_000_000 });
};

const setInputFiles = (input: HTMLInputElement, files: File[]) => {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

const openAccordion = async (testId: string, label: string) => {
  const trigger = document.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;
  if (!trigger) throw new Error(`Accordion trigger not found: ${label}`);
  if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
  await waitFor(() => trigger.getAttribute("aria-expanded") === "true", `${label} accordion open`);
};

const buttonIsEnabled = (testId: string) => {
  const button = document.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;
  return Boolean(button && !button.disabled);
};

const driveRange = (range: HTMLInputElement, value: number) => {
  range.focus();
  range.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!valueSetter) throw new Error("Could not set range value");
  valueSetter.call(range, String(value));
  range.dispatchEvent(new Event("input", { bubbles: true }));
  range.dispatchEvent(new Event("change", { bubbles: true }));
  range.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  range.blur();
};

const referenceState = () => {
  const element = document.querySelector('[data-testid="reference-current-state"]') as HTMLElement | null;
  return {
    name: element?.dataset.referenceName ?? "",
    hasSignature: element?.dataset.referenceHasSignature === "true"
  };
};

export const runPhase5AiRawDiagnostics = async () => {
  const report: AiRawDiagnosticReport = {
    startedAt: new Date().toISOString(),
    steps: [],
    summary: {
      status: "running",
      importedRows: 0,
      modelOptions: 0,
      aiConfigHidden: false,
      instructionPresent: false,
      rawReferenceReady: false,
      rawAiEnabled: false,
      rawStyleEnabled: false,
      rawCandidateApplied: false,
      rawManualEdited: false,
      rawPreviewExported: false
    }
  };
  window.__AUTO_PHOTO_PHASE5_AI_RAW_DIAGNOSTICS__ = report;
  const started = now();
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Missing #root");
  const root = ReactDOM.createRoot(rootElement);
  renderOverlay(report);

  try {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );

    await runStep(report, "wait for app mount", async () => {
      await waitFor(() => Boolean(document.querySelector('[data-testid="photo-import-input"]')), "import input");
      return "App mounted";
    });

    await runStep(report, "import JPG reference and Nikon RAW", async () => {
      const input = document.querySelector('[data-testid="photo-import-input"]') as HTMLInputElement | null;
      if (!input) throw new Error("Import input not found");
      setInputFiles(input, [await createSyntheticJpg(), await fetchRawFile()]);
      await waitFor(() => document.querySelectorAll(".asset-row").length === 2, "two imported rows", 30000);
      report.summary.importedRows = document.querySelectorAll(".asset-row").length;
      return `${report.summary.importedRows} imported rows`;
    });

    await runStep(report, "inject successful AI model list state", async () => {
      await openAccordion("accordion-ai-trigger", "AI");
      await waitFor(() => typeof window.__AUTO_PHOTO_INJECT_AI_SETTINGS__ === "function", "AI settings injection");
      window.__AUTO_PHOTO_INJECT_AI_SETTINGS__?.(
        {
          hasApiKey: true,
          model: "gpt-5.5",
          baseUrl: "https://example.test/v1/models?api_key=must-not-show#secret",
          availableModels: ["gpt-5.5", "gpt-5.1", "local-colorist"]
        },
        false
      );
      await waitFor(() => Boolean(document.querySelector('[data-testid="ai-model-select"]')), "model select visible");
      const modelSelect = document.querySelector('[data-testid="ai-model-select"]') as HTMLSelectElement | null;
      report.summary.modelOptions = modelSelect?.options.length ?? 0;
      report.summary.aiConfigHidden =
        !document.querySelector('[data-testid="ai-api-key-input"]') && !document.querySelector('[data-testid="ai-base-url-input"]');
      report.summary.instructionPresent = Boolean(document.querySelector('[data-testid="ai-instruction-input"]'));
      if (modelSelect?.value !== "gpt-5.5") throw new Error(`Expected gpt-5.5, got ${modelSelect?.value ?? "n/a"}`);
      if (report.summary.modelOptions !== 3) throw new Error(`Expected 3 model options, got ${report.summary.modelOptions}`);
      if (!report.summary.aiConfigHidden) throw new Error("AI key/base URL fields should be hidden after model list succeeds");
      if (!report.summary.instructionPresent) throw new Error("AI instruction textarea not found");
      if (document.body.textContent?.includes("must-not-show")) throw new Error("Sensitive query value leaked into UI text");
      return "Model select visible, key/base URL hidden, instruction textarea present";
    });

    await runStep(report, "set JPG as reference, select RAW, then set RAW as reference", async () => {
      await openAccordion("accordion-reference-trigger", "reference");
      const setReference = document.querySelector('[data-testid="reference-set-current-button"]') as HTMLButtonElement | null;
      if (!setReference || setReference.disabled) throw new Error("Reference button unavailable for JPG");
      setReference.click();
      await waitFor(() => buttonIsEnabled("reference-apply-current-button"), "reference style ready");
      const rawAsset = document.querySelector('[data-testid="asset-main-1"]') as HTMLButtonElement | null;
      if (!rawAsset) throw new Error("RAW asset row not found");
      rawAsset.click();
      await waitFor(
        () => Boolean(document.querySelector('.asset-row.active [data-testid="asset-main-1"]')),
        "RAW embedded preview selected"
      );
      await waitFor(() => buttonIsEnabled("reference-set-current-button"), "RAW reference button enabled");
      const setRawReference = document.querySelector('[data-testid="reference-set-current-button"]') as HTMLButtonElement | null;
      if (!setRawReference || setRawReference.disabled) throw new Error("Reference button unavailable for RAW");
      setRawReference.click();
      await waitFor(
        () => referenceState().name === "DSC_2156.NEF" && referenceState().hasSignature,
        "RAW reference style ready"
      );
      report.summary.rawReferenceReady = true;
      return "Reference set from JPG first, then RAW embedded preview set as reference";
    });

    await runStep(report, "verify RAW AI buttons and candidate apply", async () => {
      await openAccordion("accordion-ai-trigger", "AI");
      await waitFor(() => buttonIsEnabled("ai-auto-color-button"), "RAW AI color enabled");
      await waitFor(() => buttonIsEnabled("ai-style-match-button"), "RAW AI style enabled");
      report.summary.rawAiEnabled = buttonIsEnabled("ai-auto-color-button");
      report.summary.rawStyleEnabled = buttonIsEnabled("ai-style-match-button");
      const exposureRange = document.querySelector('[data-testid="edit-range-exposure"]') as HTMLInputElement | null;
      if (!exposureRange) throw new Error("Exposure control not found");
      const before = Number(exposureRange.value);
      const injected = await window.__AUTO_PHOTO_INJECT_AI_SUGGESTION__?.({
        model: "diagnostic-local",
        summary: "RAW embedded preview AI candidate",
        params: { exposure: before + 12, temperature: -6, tint: 5, contrast: 8, vibrance: 12 }
      });
      if (!injected?.params) throw new Error("Could not inject RAW AI candidate");
      await waitFor(() => Boolean(document.querySelector('[data-testid="ai-suggestion-card"]')), "RAW AI candidate card");
      const applyButton = document.querySelector('[data-testid="ai-apply-suggestion-button"]') as HTMLButtonElement | null;
      if (!applyButton || applyButton.disabled) throw new Error("RAW AI apply button unavailable");
      applyButton.click();
      const expectedExposure = Math.round(Number(injected.params.exposure));
      await waitFor(() => Number(exposureRange.value) === expectedExposure, "RAW AI candidate exposure committed");
      report.summary.rawCandidateApplied = true;
      return `RAW AI candidate applied, exposure ${before} -> ${expectedExposure}`;
    });

    await runStep(report, "verify RAW manual preview edits", async () => {
      const exposureRange = document.querySelector('[data-testid="edit-range-exposure"]') as HTMLInputElement | null;
      if (!exposureRange || exposureRange.disabled) throw new Error("RAW exposure range unavailable");
      const exposureBefore = Number(exposureRange.value);
      driveRange(exposureRange, exposureBefore + 5);
      await waitFor(() => Number(exposureRange.value) === exposureBefore + 5, "RAW exposure manual edit");

      const undoButton = document.querySelector('[data-testid="undo-button"]') as HTMLButtonElement | null;
      const redoButton = document.querySelector('[data-testid="redo-button"]') as HTMLButtonElement | null;
      if (!undoButton || undoButton.disabled) throw new Error("RAW undo button unavailable");
      undoButton.click();
      await waitFor(() => Number(exposureRange.value) === exposureBefore, "RAW manual edit undo");
      if (!redoButton || redoButton.disabled) throw new Error("RAW redo button unavailable");
      redoButton.click();
      await waitFor(() => Number(exposureRange.value) === exposureBefore + 5, "RAW manual edit redo");

      await openAccordion("accordion-hsl-trigger", "HSL");
      const redHueRange = document.querySelector('[data-testid="hsl-range-red-hue"]') as HTMLInputElement | null;
      if (!redHueRange || redHueRange.disabled) throw new Error("RAW HSL range unavailable");
      driveRange(redHueRange, 9);
      await waitFor(() => Number(redHueRange.value) === 9, "RAW HSL manual edit");
      report.summary.rawManualEdited = true;
      return `RAW manual preview edits worked: exposure ${exposureBefore} -> ${exposureBefore + 5}, red hue 9`;
    });

    await runStep(report, "verify RAW embedded preview export", async () => {
      let downloadedName = "";
      const originalAppendChild = document.body.appendChild.bind(document.body);
      const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
      const originalRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = ((value: Blob | MediaSource) =>
        value instanceof Blob && value.type === "image/jpeg" ? "blob:phase5-raw-preview-export" : originalCreateObjectUrl(value)) as typeof URL.createObjectURL;
      URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
      document.body.appendChild = ((node: Node) => {
        const appended = originalAppendChild(node);
        if (node instanceof HTMLAnchorElement) {
          downloadedName = node.download;
          node.click = () => undefined;
        }
        return appended;
      }) as typeof document.body.appendChild;
      try {
        await openAccordion("accordion-export-trigger", "export");
        const currentExportButton = document.querySelector('[data-testid="export-current-button"]') as HTMLButtonElement | null;
        if (!currentExportButton || currentExportButton.disabled) throw new Error("RAW preview export button unavailable");
        currentExportButton.click();
        await waitFor(() => downloadedName.endsWith(".jpg"), "RAW preview JPG download name");
      } finally {
        document.body.appendChild = originalAppendChild;
        URL.createObjectURL = originalCreateObjectUrl;
        URL.revokeObjectURL = originalRevokeObjectUrl;
      }
      report.summary.rawPreviewExported = true;
      return `RAW embedded preview export triggered: ${downloadedName}`;
    });

    report.summary.status = "passed";
  } catch {
    report.summary.status = "failed";
  } finally {
    report.finishedAt = new Date().toISOString();
    report.totalDurationMs = now() - started;
    renderOverlay(report);
  }

  return report;
};
