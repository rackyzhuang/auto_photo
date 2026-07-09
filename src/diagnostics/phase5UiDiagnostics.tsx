import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "../App";
import type { AiConnectionDiagnostic, AiTuningResult, ExportJobHistory } from "../types";

interface UiDiagnosticStep {
  name: string;
  status: "passed" | "failed";
  durationMs: number;
  detail: string;
}

interface UiDiagnosticReport {
  startedAt: string;
  finishedAt?: string;
  totalDurationMs?: number;
  steps: UiDiagnosticStep[];
  summary: {
    status: "running" | "passed" | "failed";
    importedCount: number;
    sliderMoves: number;
    hslMoves: number;
    compareChecks: number;
    presetApplications: number;
    referenceActions: number;
    aiCandidateActions: number;
    aiConnectionDiagnostics: number;
    exportHistoryRows: number;
    activeObjectUrls: number;
  };
  resourceSnapshots: Array<{
    label: string;
    createdObjectUrls: number;
    revokedObjectUrls: number;
    activeObjectUrls: number;
  }>;
}

declare global {
  interface Window {
    __AUTO_PHOTO_PHASE5_UI_DIAGNOSTICS__?: UiDiagnosticReport;
    __AUTO_PHOTO_INJECT_AI_CONNECTION_DIAGNOSTIC__?: (diagnostic: AiConnectionDiagnostic) => void;
    __AUTO_PHOTO_INJECT_AI_SUGGESTION__?: (result: Partial<AiTuningResult>) => Promise<AiTuningResult | undefined>;
    __AUTO_PHOTO_INJECT_EXPORT_HISTORY__?: (history: ExportJobHistory[]) => void;
  }
}

const SAMPLE_COUNT = 8;
const SLIDER_KEYS = ["exposure", "temperature", "contrast", "shadows", "vibrance"];
const MOVES_PER_SLIDER = 20;
const HSL_RANGE_KEYS = ["hsl-range-red-hue", "hsl-range-orange-saturation", "hsl-range-blue-luminance"];
const HSL_MOVES_PER_RANGE = 8;

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
      0.88
    );
  });

const createSyntheticJpg = async (index: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 820;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create UI diagnostic canvas");

  const hue = (index * 41) % 360;
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, `hsl(${hue}, 62%, 70%)`);
  gradient.addColorStop(0.58, `hsl(${(hue + 70) % 360}, 48%, 46%)`);
  gradient.addColorStop(1, `hsl(${(hue + 180) % 360}, 42%, 24%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255, 232, 205, 0.74)";
  ctx.beginPath();
  ctx.ellipse(canvas.width * 0.34, canvas.height * 0.48, 130, 160, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  for (let stripe = 0; stripe < 8; stripe += 1) {
    ctx.fillRect(canvas.width * (0.54 + stripe * 0.045), 140, 24, 520);
  }
  ctx.fillStyle = "rgba(0,0,0,0.24)";
  ctx.font = '700 40px "Segoe UI", sans-serif';
  ctx.fillText(`UI-${String(index + 1).padStart(2, "0")}`, 44, canvas.height - 46);
  return canvasToFile(canvas, `phase5-ui-sample-${String(index + 1).padStart(2, "0")}.jpg`);
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
    snapshot: (label: string) => ({
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

const renderOverlay = (report: UiDiagnosticReport) => {
  let overlay = document.getElementById("phase5-ui-diagnostics");
  if (!overlay) {
    overlay = document.createElement("section");
    overlay.id = "phase5-ui-diagnostics";
    overlay.style.position = "fixed";
    overlay.style.left = "12px";
    overlay.style.bottom = "12px";
    overlay.style.zIndex = "9999";
    overlay.style.width = "520px";
    overlay.style.maxHeight = "50vh";
    overlay.style.overflow = "auto";
    overlay.style.padding = "12px";
    overlay.style.background = "rgba(255,255,255,0.96)";
    overlay.style.border = "1px solid #ccd3db";
    overlay.style.boxShadow = "0 8px 28px rgba(0,0,0,0.16)";
    overlay.style.font = '12px/1.45 "Segoe UI", sans-serif';
    document.body.appendChild(overlay);
  }

  const rows = report.steps
    .map((step) => `<tr><td>${step.status}</td><td>${step.name}</td><td>${Math.round(step.durationMs)} ms</td><td>${step.detail}</td></tr>`)
    .join("");
  const resources = report.resourceSnapshots
    .map((item) => `<tr><td>${item.label}</td><td>${item.createdObjectUrls}</td><td>${item.revokedObjectUrls}</td><td>${item.activeObjectUrls}</td></tr>`)
    .join("");
  overlay.innerHTML = `
    <strong>Phase 5 UI Diagnostics: ${report.summary.status}</strong>
    <div>Imported ${report.summary.importedCount} / Slider moves ${report.summary.sliderMoves} / HSL moves ${report.summary.hslMoves} / Presets ${report.summary.presetApplications} / Reference ${report.summary.referenceActions} / AI candidates ${report.summary.aiCandidateActions} / AI diagnostics ${report.summary.aiConnectionDiagnostics} / Export history ${report.summary.exportHistoryRows} / Active URLs ${report.summary.activeObjectUrls}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:8px"><tbody>${rows}</tbody></table>
    <table style="width:100%;border-collapse:collapse;margin-top:8px"><tbody>${resources}</tbody></table>
  `;
  overlay.querySelectorAll("td").forEach((cell) => {
    const element = cell as HTMLElement;
    element.style.borderTop = "1px solid #e4e8ec";
    element.style.padding = "4px";
  });
};

const runStep = async (report: UiDiagnosticReport, name: string, run: () => Promise<string>) => {
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

const setInputFiles = (input: HTMLInputElement, files: File[]) => {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
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

const openAccordion = async (testId: string, label: string) => {
  const trigger = document.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;
  if (!trigger) throw new Error(`Accordion trigger not found: ${label}`);
  if (trigger.getAttribute("aria-expanded") !== "true") {
    trigger.click();
  }
  await waitFor(() => trigger.getAttribute("aria-expanded") === "true", `${label} accordion open`);
};

const getEnabledButton = async (testId: string, label: string) => {
  await waitFor(() => {
    const button = document.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;
    return Boolean(button && !button.disabled);
  }, `${label} enabled`);
  return document.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement;
};

const createDiagnosticExportHistory = (): ExportJobHistory[] => [
  {
    jobId: "diagnostic-export-long-path",
    createdAt: "2026-07-08 08:30:00",
    mode: "batch",
    status: "completed_with_failures",
    totalCount: 18,
    completedCount: 17,
    failedCount: 1,
    outputDir:
      "C:\\Users\\Administrator\\Desktop\\auto_photo\\diagnostics\\very-long-folder-name-with-client-project-and-camera-profile\\exports\\2026-07-08\\sony-nikon-mixed-set",
    items: [],
    failed: [
      {
        assetId: "diagnostic-failed-asset",
        name: "very-long-file-name-for-export-history-layout-check.jpg",
        reason: "diagnostic failure with a very long file-system message from https://private.example.invalid/export?token=secret and authorization detail that must not stretch the panel"
      }
    ]
  },
  {
    jobId: "diagnostic-export-cancelled",
    createdAt: "2026-07-08 08:31:00",
    mode: "retry",
    status: "cancelled",
    totalCount: 3,
    completedCount: 1,
    failedCount: 0,
    outputDir: "C:\\exports",
    items: [
      {
        assetId: "diagnostic-written-asset",
        name: "cancelled-before-second-file.jpg",
        status: "written",
        outputName: "cancelled-before-second-file.jpg",
        outputPath: "C:\\exports\\cancelled-before-second-file.jpg"
      }
    ]
  }
];

const assertExportHistoryLayout = () => {
  const history = document.querySelector('[data-testid="export-history"]') as HTMLElement | null;
  if (!history) throw new Error("Export history not found");
  if (history.scrollWidth > history.clientWidth + 2) {
    throw new Error(`Export history overflow: ${history.scrollWidth} > ${history.clientWidth}`);
  }

  const rows = Array.from(history.querySelectorAll("li")) as HTMLElement[];
  rows.forEach((row, index) => {
    if (row.scrollWidth > row.clientWidth + 2) {
      throw new Error(`Export history row ${index} overflow: ${row.scrollWidth} > ${row.clientWidth}`);
    }
  });

  const pathLines = Array.from(history.querySelectorAll("li small")) as HTMLElement[];
  pathLines.forEach((line, index) => {
    const style = window.getComputedStyle(line);
    const truncates = style.overflow === "hidden" && style.textOverflow === "ellipsis" && style.whiteSpace === "nowrap";
    if (line.scrollWidth > line.clientWidth + 2 && !truncates) {
      throw new Error(`Export history path ${index} can overflow without truncation`);
    }
  });

  const details = Array.from(history.querySelectorAll('[data-testid^="export-history-detail-"]')) as HTMLElement[];
  if (details.length < 2) {
    throw new Error(`Expected export history detail rows, got ${details.length}`);
  }
  details.forEach((detail, index) => {
    if (detail.scrollWidth > detail.clientWidth + 2) {
      const style = window.getComputedStyle(detail);
      const truncates = style.overflow === "hidden" && style.textOverflow === "ellipsis" && style.whiteSpace === "nowrap";
      if (!truncates) throw new Error(`Export history detail ${index} can overflow without truncation`);
    }
  });
  const historyText = history.textContent ?? "";
  if (historyText.includes("https://") || historyText.includes("Bearer ") || /sk-[A-Za-z0-9]{12,}/.test(historyText)) {
    throw new Error("Export history leaked secret-looking detail");
  }

  return rows.length;
};

const assertExportTargetLayout = () => {
  const target = document.querySelector('[data-testid="export-target"]') as HTMLElement | null;
  if (!target) throw new Error("Export target status not found");
  if (target.scrollWidth > target.clientWidth + 2) {
    throw new Error(`Export target overflow: ${target.scrollWidth} > ${target.clientWidth}`);
  }

  const value = target.querySelector("strong") as HTMLElement | null;
  if (!value?.textContent?.trim()) throw new Error("Export target value is empty");
  const style = value ? window.getComputedStyle(value) : undefined;
  const truncates = style?.overflow === "hidden" && style.textOverflow === "ellipsis" && style.whiteSpace === "nowrap";
  if (value && value.scrollWidth > value.clientWidth + 2 && !truncates) {
    throw new Error("Export target long value can overflow without truncation");
  }
};

const assertDirectoryButtonLayout = () => {
  const button = document.querySelector('[data-testid="export-directory-button"]') as HTMLElement | null;
  if (!button) return;
  if (button.scrollWidth > button.clientWidth + 2) {
    throw new Error(`Export directory button overflow: ${button.scrollWidth} > ${button.clientWidth}`);
  }
};

const assertAiConnectionDiagnosticLayout = (expectedStatus: "passed" | "failed") => {
  const diagnostic = document.querySelector('[data-testid="ai-connection-diagnostic"]') as HTMLElement | null;
  if (!diagnostic) throw new Error("AI connection diagnostic result not found");
  if (!diagnostic.classList.contains(expectedStatus)) {
    throw new Error(`AI connection diagnostic status class mismatch for ${expectedStatus}`);
  }
  if (diagnostic.scrollWidth > diagnostic.clientWidth + 2) {
    throw new Error(`AI connection diagnostic overflow: ${diagnostic.scrollWidth} > ${diagnostic.clientWidth}`);
  }
  const text = diagnostic.textContent ?? "";
  if (text.includes("https://") || text.includes("Bearer ") || /sk-[A-Za-z0-9]{12,}/.test(text)) {
    throw new Error("AI connection diagnostic leaked secret-looking content");
  }
  if (!text.includes("个模型") || !text.includes("模型")) {
    throw new Error("AI connection diagnostic missing model count or model label");
  }
};

const assertPreviewPanelBounds = () => {
  const app = document.querySelector(".app-shell") as HTMLElement | null;
  const preview = document.querySelector(".preview-panel") as HTMLElement | null;
  const editPanel = document.querySelector(".edit-panel") as HTMLElement | null;
  if (!app || !preview || !editPanel) throw new Error("Main layout panels not found");

  const appRect = app.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();
  const editRect = editPanel.getBoundingClientRect();
  const previewZIndex = Number.parseInt(window.getComputedStyle(preview).zIndex, 10);
  const editZIndex = Number.parseInt(window.getComputedStyle(editPanel).zIndex, 10);
  if (previewRect.right > editRect.left + 1) {
    throw new Error(`Preview panel overlaps edit panel: ${previewRect.right.toFixed(1)} > ${editRect.left.toFixed(1)}`);
  }
  if (!Number.isFinite(previewZIndex) || !Number.isFinite(editZIndex) || editZIndex <= previewZIndex) {
    throw new Error(`Edit panel stacking order is not above preview panel: ${editZIndex} <= ${previewZIndex}`);
  }
  if (editRect.right > appRect.right + 1) {
    throw new Error(`Edit panel escapes app shell: ${editRect.right.toFixed(1)} > ${appRect.right.toFixed(1)}`);
  }
  if (app.scrollWidth > app.clientWidth + 2) {
    throw new Error(`App shell horizontal overflow: ${app.scrollWidth} > ${app.clientWidth}`);
  }
};

const assertCompareLayout = (expectedSplit: number) => {
  assertPreviewPanelBounds();
  const view = document.querySelector('[data-testid="compare-view"]') as HTMLElement | null;
  const slider = document.querySelector('[data-testid="compare-slider"]') as HTMLInputElement | null;
  const divider = document.querySelector(".compare-divider") as HTMLElement | null;
  const editedLayer = document.querySelector(".compare-edited-layer") as HTMLElement | null;
  if (!view || !slider || !divider || !editedLayer) throw new Error("Compare view controls not found");

  const viewRect = view.getBoundingClientRect();
  const sliderRect = slider.getBoundingClientRect();
  const dividerRect = divider.getBoundingClientRect();
  if (view.scrollWidth > view.clientWidth + 2 || view.scrollHeight > view.clientHeight + 2) {
    throw new Error(`Compare view overflow: ${view.scrollWidth}x${view.scrollHeight} > ${view.clientWidth}x${view.clientHeight}`);
  }
  if (sliderRect.left < viewRect.left - 1 || sliderRect.right > viewRect.right + 1) {
    throw new Error("Compare slider escapes compare view");
  }

  const dividerCenter = dividerRect.left + dividerRect.width / 2;
  const expectedX = viewRect.left + (viewRect.width * expectedSplit) / 100;
  if (Math.abs(dividerCenter - expectedX) > 3) {
    throw new Error(`Compare divider mismatch: ${dividerCenter.toFixed(1)} != ${expectedX.toFixed(1)}`);
  }

  const clipPath = editedLayer.style.clipPath;
  if (!clipPath.includes(`${100 - expectedSplit}%`)) {
    throw new Error(`Compare edited layer clip not updated: ${clipPath}`);
  }
};

export const runPhase5UiDiagnostics = async () => {
  const report: UiDiagnosticReport = {
    startedAt: new Date().toISOString(),
    steps: [],
    resourceSnapshots: [],
    summary: {
      status: "running",
      importedCount: 0,
      sliderMoves: 0,
      hslMoves: 0,
      compareChecks: 0,
      presetApplications: 0,
      referenceActions: 0,
      aiCandidateActions: 0,
      aiConnectionDiagnostics: 0,
      exportHistoryRows: 0,
      activeObjectUrls: 0
    }
  };
  window.__AUTO_PHOTO_PHASE5_UI_DIAGNOSTICS__ = report;
  const urlMonitor = createObjectUrlMonitor();
  const captureResources = (label: string) => {
    const snapshot = urlMonitor.snapshot(label);
    report.resourceSnapshots.push(snapshot);
    report.summary.activeObjectUrls = snapshot.activeObjectUrls;
  };

  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Missing #root");
  const root = ReactDOM.createRoot(rootElement);
  const started = now();
  captureResources("start");
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

    const files: File[] = [];
    await runStep(report, `generate ${SAMPLE_COUNT} UI samples`, async () => {
      for (let index = 0; index < SAMPLE_COUNT; index += 1) {
        files.push(await createSyntheticJpg(index));
      }
      return `${files.length} files generated`;
    });

    await runStep(report, `import ${SAMPLE_COUNT} samples through App UI`, async () => {
      const input = document.querySelector('[data-testid="photo-import-input"]') as HTMLInputElement | null;
      if (!input) throw new Error("Import input not found");
      setInputFiles(input, files);
      await waitFor(() => document.querySelectorAll(".asset-row").length === SAMPLE_COUNT, "asset rows");
      report.summary.importedCount = document.querySelectorAll(".asset-row").length;
      return `${report.summary.importedCount} asset rows`;
    });
    captureResources("after ui import");

    await runStep(report, `${SLIDER_KEYS.length} sliders x ${MOVES_PER_SLIDER} moves`, async () => {
      for (const key of SLIDER_KEYS) {
        const range = document.querySelector(`[data-testid="edit-range-${key}"]`) as HTMLInputElement | null;
        if (!range) throw new Error(`Range not found: ${key}`);
        await waitFor(() => !range.disabled, `${key} enabled`);
        const min = Number(range.min);
        const max = Number(range.max);
        for (let move = 0; move < MOVES_PER_SLIDER; move += 1) {
          const value = Math.round(min + ((max - min) * ((move + 1) % MOVES_PER_SLIDER)) / MOVES_PER_SLIDER);
          driveRange(range, value);
          report.summary.sliderMoves += 1;
          if (move % 5 === 0) await delay(20);
        }
      }
      await waitFor(() => Boolean(document.querySelector(".image-stage img")), "preview image after slider moves");
      return `${report.summary.sliderMoves} range updates`;
    });
    captureResources("after slider moves");

    await runStep(report, "split compare layout and right panel bounds", async () => {
      const compareButton = await getEnabledButton("compare-mode-button", "compare mode");
      compareButton.click();
      await waitFor(() => Boolean(document.querySelector('[data-testid="compare-view"]')), "compare view");
      const slider = document.querySelector('[data-testid="compare-slider"]') as HTMLInputElement | null;
      if (!slider) throw new Error("Compare slider not found");
      for (const split of [25, 50, 75]) {
        driveRange(slider, split);
        await waitFor(() => Number(slider.value) === split, `compare split ${split}`);
        assertCompareLayout(split);
        report.summary.compareChecks += 1;
      }
      compareButton.click();
      compareButton.click();
      await waitFor(() => !document.querySelector('[data-testid="compare-view"]'), "compare view closed");
      assertPreviewPanelBounds();
      return `${report.summary.compareChecks} compare split positions checked`;
    });
    captureResources("after compare layout");

    await runStep(report, "open HSL, preset, and reference panels", async () => {
      await openAccordion("accordion-hsl-trigger", "HSL");
      await openAccordion("accordion-presets-trigger", "presets");
      await openAccordion("accordion-reference-trigger", "reference");
      await waitFor(() => Boolean(document.querySelector('[data-testid="hsl-range-red-hue"]')), "HSL range");
      await waitFor(() => Boolean(document.querySelector('[data-testid="preset-button-landscape-blue-sky"]')), "preset button");
      await waitFor(() => Boolean(document.querySelector('[data-testid="reference-set-current-button"]')), "reference button");
      return "Advanced panels opened";
    });

    await runStep(report, `${HSL_RANGE_KEYS.length} HSL ranges x ${HSL_MOVES_PER_RANGE} moves`, async () => {
      for (const key of HSL_RANGE_KEYS) {
        const range = document.querySelector(`[data-testid="${key}"]`) as HTMLInputElement | null;
        if (!range) throw new Error(`HSL range not found: ${key}`);
        await waitFor(() => !range.disabled, `${key} enabled`);
        const min = Number(range.min);
        const max = Number(range.max);
        for (let move = 0; move < HSL_MOVES_PER_RANGE; move += 1) {
          const ratio = ((move + 2) % HSL_MOVES_PER_RANGE) / HSL_MOVES_PER_RANGE;
          const value = Math.round(min + (max - min) * ratio);
          driveRange(range, value);
          report.summary.hslMoves += 1;
          if (move % 4 === 0) await delay(20);
        }
      }
      await waitFor(() => Boolean(document.querySelector(".image-stage img")), "preview image after HSL moves");
      return `${report.summary.hslMoves} HSL range updates`;
    });
    captureResources("after HSL moves");

    await runStep(report, "apply built-in preset", async () => {
      const presetButton = await getEnabledButton("preset-button-landscape-blue-sky", "landscape preset");
      presetButton.click();
      report.summary.presetApplications += 1;
      await waitFor(() => Boolean(document.querySelector(".image-stage img")), "preview image after preset");
      return "Built-in preset applied";
    });
    captureResources("after preset apply");

    await runStep(report, "set and apply reference style", async () => {
      const strength = document.querySelector('[data-testid="reference-strength-range"]') as HTMLInputElement | null;
      if (!strength) throw new Error("Reference strength range not found");
      driveRange(strength, 80);
      report.summary.referenceActions += 1;

      const setReference = await getEnabledButton("reference-set-current-button", "set current as reference");
      setReference.click();
      report.summary.referenceActions += 1;
      await getEnabledButton("reference-apply-current-button", "apply reference");

      const secondAsset = document.querySelector('[data-testid="asset-main-1"]') as HTMLButtonElement | null;
      if (!secondAsset) throw new Error("Second imported asset not found");
      secondAsset.click();
      report.summary.referenceActions += 1;
      await waitFor(() => Boolean(document.querySelector(".asset-row.active [data-testid=\"asset-main-1\"]")), "second asset selected");

      const applyReference = await getEnabledButton("reference-apply-current-button", "apply reference to selected");
      applyReference.click();
      report.summary.referenceActions += 1;
      await waitFor(() => Boolean(document.querySelector(".image-stage img")), "preview image after reference apply");
      return `${report.summary.referenceActions} reference actions`;
    });
    captureResources("after reference style");

    await runStep(report, "AI candidate cancel and apply", async () => {
      await openAccordion("accordion-ai-trigger", "AI");
      await waitFor(
        () => typeof window.__AUTO_PHOTO_INJECT_AI_CONNECTION_DIAGNOSTIC__ === "function",
        "AI connection diagnostic injection"
      );
      window.__AUTO_PHOTO_INJECT_AI_CONNECTION_DIAGNOSTIC__?.({
        status: "passed",
        hasApiKey: true,
        model: "diagnostic-model",
        modelAvailable: true,
        modelCount: 7,
        message: "AI 连接诊断通过：已获取 7 个模型，当前模型可用。"
      });
      await waitFor(() => Boolean(document.querySelector('[data-testid="ai-connection-diagnostic"].passed')), "AI connection passed result");
      assertAiConnectionDiagnosticLayout("passed");
      report.summary.aiConnectionDiagnostics += 1;

      window.__AUTO_PHOTO_INJECT_AI_CONNECTION_DIAGNOSTIC__?.({
        status: "failed",
        hasApiKey: true,
        model: "diagnostic-missing-model",
        modelAvailable: false,
        modelCount: 3,
        message:
          "AI 连接诊断通过：已获取 3 个模型，但当前模型不在模型列表中，请切换可用模型。这是一段很长的安全诊断消息，用于确认右侧面板不会出现横向溢出。"
      });
      await waitFor(() => Boolean(document.querySelector('[data-testid="ai-connection-diagnostic"].failed')), "AI connection failed result");
      assertAiConnectionDiagnosticLayout("failed");
      report.summary.aiConnectionDiagnostics += 1;

      await waitFor(() => typeof window.__AUTO_PHOTO_INJECT_AI_SUGGESTION__ === "function", "AI diagnostic injection");
      const exposureRange = document.querySelector('[data-testid="edit-range-exposure"]') as HTMLInputElement | null;
      if (!exposureRange) throw new Error("Exposure range not found");
      const beforeCancel = Number(exposureRange.value);

      const cancelCandidate = await window.__AUTO_PHOTO_INJECT_AI_SUGGESTION__?.({
        model: "diagnostic-local",
        summary: "Cancel path should not change edits",
        params: { exposure: beforeCancel + 11, temperature: -8, contrast: 7, vibrance: 14 }
      });
      if (!cancelCandidate?.params) throw new Error("Could not inject cancel-path AI candidate");
      report.summary.aiCandidateActions += 1;
      await waitFor(() => Boolean(document.querySelector('[data-testid="ai-suggestion-card"]')), "AI candidate card for cancel");
      const cancelButton = await getEnabledButton("ai-cancel-suggestion-button", "cancel AI candidate");
      cancelButton.click();
      report.summary.aiCandidateActions += 1;
      await waitFor(() => !document.querySelector('[data-testid="ai-suggestion-card"]'), "AI candidate removed after cancel");
      const afterCancel = Number(exposureRange.value);
      if (afterCancel !== beforeCancel) {
        throw new Error(`AI cancel changed exposure from ${beforeCancel} to ${afterCancel}`);
      }

      const targetExposure = Math.max(-40, Math.min(40, beforeCancel + 13));
      const applyCandidate = await window.__AUTO_PHOTO_INJECT_AI_SUGGESTION__?.({
        model: "diagnostic-local",
        summary: "Apply path should commit edits",
        params: { exposure: targetExposure, temperature: -5, contrast: 9, vibrance: 16 }
      });
      const expectedExposure = Math.round(Number(applyCandidate?.params?.exposure));
      if (!Number.isFinite(expectedExposure)) throw new Error("Could not inject apply-path AI candidate");
      report.summary.aiCandidateActions += 1;
      await waitFor(() => Boolean(document.querySelector('[data-testid="ai-suggestion-card"]')), "AI candidate card for apply");
      const applyButton = await getEnabledButton("ai-apply-suggestion-button", "apply AI candidate");
      applyButton.click();
      report.summary.aiCandidateActions += 1;
      await waitFor(() => !document.querySelector('[data-testid="ai-suggestion-card"]'), "AI candidate removed after apply");
      await waitFor(() => Number(exposureRange.value) === expectedExposure, "AI candidate exposure committed");
      await waitFor(() => Boolean(document.querySelector(".image-stage img")), "preview image after AI candidate apply");
      return `${report.summary.aiCandidateActions} AI candidate actions`;
    });
    captureResources("after AI candidate");

    await runStep(report, "inject export history layout cases", async () => {
      await openAccordion("accordion-export-trigger", "export");
      assertExportTargetLayout();
      assertDirectoryButtonLayout();
      await waitFor(() => typeof window.__AUTO_PHOTO_INJECT_EXPORT_HISTORY__ === "function", "export history diagnostic injection");
      window.__AUTO_PHOTO_INJECT_EXPORT_HISTORY__?.(createDiagnosticExportHistory());
      await waitFor(() => document.querySelectorAll('[data-testid^="export-history-row-"]').length === 2, "export history rows");
      const rows = assertExportHistoryLayout();
      report.summary.exportHistoryRows = rows;
      return `${rows} export history rows rendered without horizontal overflow`;
    });
    captureResources("after export history");

    await runStep(report, "clear imported assets", async () => {
      const button = document.querySelector('[data-testid="clear-assets-button"]') as HTMLButtonElement | null;
      if (!button) throw new Error("Clear button not found");
      if (button.disabled) throw new Error("Clear button is disabled");
      button.click();
      await waitFor(() => document.querySelectorAll(".asset-row").length === 0, "asset rows cleared");
      report.summary.importedCount = 0;
      return "Assets cleared";
    });
    captureResources("after clear");

    report.summary.status = "passed";
  } catch {
    report.summary.status = "failed";
  } finally {
    captureResources("final");
    report.finishedAt = new Date().toISOString();
    report.totalDurationMs = now() - started;
    urlMonitor.restore();
    renderOverlay(report);
  }

  return report;
};
