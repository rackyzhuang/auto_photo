import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "../App";
import type { AiSettingsState } from "../types";

interface AiBatchExportStep {
  name: string;
  status: "passed" | "failed";
  durationMs: number;
  detail: string;
}

interface AiBatchExportReport {
  startedAt: string;
  finishedAt?: string;
  totalDurationMs?: number;
  steps: AiBatchExportStep[];
  summary: {
    status: "running" | "passed" | "failed";
    importedRows: number;
    batchAiAutoApplied: boolean;
    batchAiStyleApplied: boolean;
    jpgChanged: boolean;
    rawChanged: boolean;
    rawChangedCount: number;
    exportedCount: number;
    exportedNames: string[];
  };
}

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

declare global {
  interface Window {
    __AUTO_PHOTO_PHASE5_AI_BATCH_EXPORT_DIAGNOSTICS__?: AiBatchExportReport;
    __AUTO_PHOTO_INJECT_AI_SETTINGS__?: (settings: AiSettingsState, editing?: boolean) => void;
  }
}

const now = () => performance.now();
const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const waitFor = async (check: () => boolean, label: string, timeoutMs = 20000) => {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (check()) return;
    await delay(80);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const renderOverlay = (report: AiBatchExportReport) => {
  let overlay = document.getElementById("phase5-ai-batch-export-diagnostics");
  if (!overlay) {
    overlay = document.createElement("section");
    overlay.id = "phase5-ai-batch-export-diagnostics";
    overlay.style.position = "fixed";
    overlay.style.left = "12px";
    overlay.style.bottom = "12px";
    overlay.style.zIndex = "9999";
    overlay.style.width = "620px";
    overlay.style.maxHeight = "56vh";
    overlay.style.overflow = "auto";
    overlay.style.padding = "12px";
    overlay.style.background = "rgba(255,255,255,0.96)";
    overlay.style.border = "1px solid #ccd3db";
    overlay.style.boxShadow = "0 8px 28px rgba(0,0,0,0.16)";
    overlay.style.font = '12px/1.45 "Segoe UI", sans-serif';
    document.body.appendChild(overlay);
  }

  document.documentElement.dataset.phase5AiBatchExportStatus = report.summary.status;
  document.documentElement.dataset.phase5AiBatchExportRows = String(report.summary.importedRows);
  document.documentElement.dataset.phase5AiBatchExportAuto = String(report.summary.batchAiAutoApplied);
  document.documentElement.dataset.phase5AiBatchExportStyle = String(report.summary.batchAiStyleApplied);
  document.documentElement.dataset.phase5AiBatchExportDownloads = String(report.summary.exportedCount);

  const rows = report.steps
    .map((step) => `<tr><td>${step.status}</td><td>${step.name}</td><td>${Math.round(step.durationMs)} ms</td><td>${step.detail}</td></tr>`)
    .join("");
  overlay.innerHTML = `
    <strong>Phase 5 AI Batch Export Diagnostics: ${report.summary.status}</strong>
    <div>Rows ${report.summary.importedRows} / AI Auto ${report.summary.batchAiAutoApplied} / AI Style ${report.summary.batchAiStyleApplied} / JPG changed ${report.summary.jpgChanged} / RAW changed ${report.summary.rawChangedCount}/${RAW_SAMPLES.length} / Exports ${report.summary.exportedCount}</div>
    <div>${report.summary.exportedNames.join(" · ")}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:8px"><tbody>${rows}</tbody></table>
  `;
  overlay.querySelectorAll("td").forEach((cell) => {
    const element = cell as HTMLElement;
    element.style.borderTop = "1px solid #e4e8ec";
    element.style.padding = "4px";
  });
};

const runStep = async (report: AiBatchExportReport, name: string, run: () => Promise<string>) => {
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
  canvas.width = 1280;
  canvas.height = 860;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create synthetic JPG");
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "hsl(210, 58%, 68%)");
  gradient.addColorStop(0.5, "hsl(36, 46%, 48%)");
  gradient.addColorStop(1, "hsl(232, 36%, 22%)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255, 226, 204, 0.78)";
  ctx.beginPath();
  ctx.ellipse(canvas.width * 0.34, canvas.height * 0.48, 148, 178, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(canvas.width * 0.56, 150, 260, 500);
  ctx.fillStyle = "rgba(0,0,0,0.24)";
  ctx.font = '700 42px "Segoe UI", sans-serif';
  ctx.fillText("AI-BATCH-JPG", 44, canvas.height - 48);
  return canvasToFile(canvas, "phase5-ai-batch-reference.jpg");
};

const fetchRawFile = async (sample: (typeof RAW_SAMPLES)[number]) => {
  const response = await fetch(sample.url);
  if (!response.ok) throw new Error(`${sample.label} fetch failed: ${response.status} ${response.statusText}`);
  const blob = await response.blob();
  return new File([blob], sample.name, { type: sample.type, lastModified: 1_788_800_000_000 });
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

const button = (testId: string) => document.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;

const buttonIsEnabled = (testId: string) => {
  const element = button(testId);
  return Boolean(element && !element.disabled);
};

const setTextarea = (testId: string, value: string) => {
  const textarea = document.querySelector(`[data-testid="${testId}"]`) as HTMLTextAreaElement | null;
  if (!textarea) throw new Error(`Textarea not found: ${testId}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) throw new Error("Could not set textarea value");
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
};

const rangeValue = (testId: string) => {
  const range = document.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement | null;
  if (!range) throw new Error(`Range not found: ${testId}`);
  return Number(range.value);
};

const editProbe = () => ({
  exposure: rangeValue("edit-range-exposure"),
  temperature: rangeValue("edit-range-temperature"),
  contrast: rangeValue("edit-range-contrast"),
  vibrance: rangeValue("edit-range-vibrance"),
  skinSmoothing: rangeValue("edit-range-skinSmoothing"),
  teethWhitening: rangeValue("edit-range-teethWhitening"),
  grain: rangeValue("edit-range-grain")
});

const probeChanged = (before: ReturnType<typeof editProbe>, after: ReturnType<typeof editProbe>) =>
  Object.keys(before).some((key) => before[key as keyof typeof before] !== after[key as keyof typeof after]);

const selectAsset = async (index: number, label: string) => {
  const assetButton = document.querySelector(`[data-testid="asset-main-${index}"]`) as HTMLButtonElement | null;
  if (!assetButton) throw new Error(`Asset row not found: ${label}`);
  assetButton.click();
  await waitFor(() => Boolean(document.querySelector(`.asset-row.active [data-testid="asset-main-${index}"]`)), `${label} selected`);
};

const waitForBatchIdle = async () => {
  await waitFor(() => {
    const badge = document.querySelector(".batch-process-badge");
    return Boolean(badge?.textContent?.includes(`${1 + RAW_SAMPLES.length}/${1 + RAW_SAMPLES.length}`));
  }, "batch process completed", 30000);
};

const installDownloadCapture = (downloadedNames: string[]) => {
  const originalAppendChild = document.body.appendChild.bind(document.body);
  const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
  const originalRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = ((value: Blob | MediaSource) =>
    value instanceof Blob && value.type === "image/jpeg"
      ? `blob:phase5-ai-batch-export-${downloadedNames.length + 1}`
      : originalCreateObjectUrl(value)) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
  document.body.appendChild = ((node: Node) => {
    const appended = originalAppendChild(node);
    if (node instanceof HTMLAnchorElement) {
      downloadedNames.push(node.download);
      node.click = () => undefined;
    }
    return appended;
  }) as typeof document.body.appendChild;
  return () => {
    document.body.appendChild = originalAppendChild;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  };
};

export const runPhase5AiBatchExportDiagnostics = async () => {
  const report: AiBatchExportReport = {
    startedAt: new Date().toISOString(),
    steps: [],
    summary: {
      status: "running",
      importedRows: 0,
      batchAiAutoApplied: false,
      batchAiStyleApplied: false,
      jpgChanged: false,
      rawChanged: false,
      rawChangedCount: 0,
      exportedCount: 0,
      exportedNames: []
    }
  };
  window.__AUTO_PHOTO_PHASE5_AI_BATCH_EXPORT_DIAGNOSTICS__ = report;
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

    await runStep(report, "import synthetic JPG, Nikon RAW and Sony RAW", async () => {
      const input = document.querySelector('[data-testid="photo-import-input"]') as HTMLInputElement | null;
      if (!input) throw new Error("Import input not found");
      setInputFiles(input, [await createSyntheticJpg(), ...(await Promise.all(RAW_SAMPLES.map((sample) => fetchRawFile(sample))))]);
      await waitFor(() => document.querySelectorAll(".asset-row").length === 1 + RAW_SAMPLES.length, "three imported rows", 45000);
      report.summary.importedRows = document.querySelectorAll(".asset-row").length;
      return `${report.summary.importedRows} imported rows`;
    });

    await runStep(report, "inject AI settings and set reference style", async () => {
      await openAccordion("accordion-ai-trigger", "AI");
      await waitFor(() => typeof window.__AUTO_PHOTO_INJECT_AI_SETTINGS__ === "function", "AI settings injection");
      window.__AUTO_PHOTO_INJECT_AI_SETTINGS__?.(
        {
          hasApiKey: false,
          model: "local-color-science",
          baseUrl: "https://example.test/v1?api_key=must-not-show",
          availableModels: ["local-color-science"]
        },
        false
      );
      setTextarea("ai-instruction-input", "批量做暖调通透人像，压高光，肤色自然，轻微胶片感，美齿和磨皮");
      await openAccordion("accordion-reference-trigger", "reference");
      const referenceButton = button("reference-set-current-button");
      if (!referenceButton || referenceButton.disabled) throw new Error("Reference button unavailable for JPG");
      referenceButton.click();
      await waitFor(() => buttonIsEnabled("ai-batch-style-match-button"), "batch style button enabled");
      if (document.body.textContent?.includes("must-not-show")) throw new Error("Sensitive query value leaked into UI text");
      return "AI local settings injected, instruction set, JPG reference ready";
    });

    let jpgProbeBefore: ReturnType<typeof editProbe> = {
      exposure: 0,
      temperature: 0,
      contrast: 0,
      vibrance: 0,
      skinSmoothing: 0,
      teethWhitening: 0,
      grain: 0
    };
    let jpgProbeAfter: ReturnType<typeof editProbe> = { ...jpgProbeBefore };
    let rawProbeAfter: Array<ReturnType<typeof editProbe>> = [];
    await runStep(report, "run batch AI auto color for JPG, Nikon RAW and Sony RAW", async () => {
      await openAccordion("accordion-ai-trigger", "AI");
      await openAccordion("accordion-portrait-trigger", "portrait");
      await selectAsset(0, "JPG");
      jpgProbeBefore = editProbe();
      const autoButton = button("ai-batch-auto-color-button");
      if (!autoButton || autoButton.disabled) throw new Error("Batch AI auto button unavailable");
      autoButton.click();
      await waitFor(
        () => Boolean(document.querySelector(".batch-process-badge")?.textContent?.includes(`${1 + RAW_SAMPLES.length}/${1 + RAW_SAMPLES.length}`)),
        "batch AI auto completed",
        45000
      );
      await selectAsset(0, "JPG");
      jpgProbeAfter = editProbe();
      rawProbeAfter = [];
      for (let index = 0; index < RAW_SAMPLES.length; index += 1) {
        await selectAsset(index + 1, RAW_SAMPLES[index].label);
        rawProbeAfter.push(editProbe());
      }
      report.summary.batchAiAutoApplied = true;
      report.summary.jpgChanged = probeChanged(jpgProbeBefore, jpgProbeAfter);
      report.summary.rawChangedCount = rawProbeAfter.filter((probe) => Object.values(probe).some((value) => value !== 0)).length;
      report.summary.rawChanged = report.summary.rawChangedCount === RAW_SAMPLES.length;
      if (!report.summary.jpgChanged) throw new Error(`JPG probe did not change: ${JSON.stringify(jpgProbeBefore)} -> ${JSON.stringify(jpgProbeAfter)}`);
      if (!report.summary.rawChanged) throw new Error(`RAW probes did not all change: ${JSON.stringify(rawProbeAfter)}`);
      await waitForBatchIdle();
      return `JPG probe ${JSON.stringify(jpgProbeBefore)} -> ${JSON.stringify(jpgProbeAfter)}; RAW probes ${JSON.stringify(rawProbeAfter)}`;
    });

    await runStep(report, "run batch AI style match for JPG, Nikon RAW and Sony RAW", async () => {
      await openAccordion("accordion-ai-trigger", "AI");
      await waitFor(() => buttonIsEnabled("ai-batch-style-match-button"), "batch AI style button enabled", 30000);
      const styleButton = button("ai-batch-style-match-button");
      if (!styleButton || styleButton.disabled) throw new Error("Batch AI style button unavailable");
      styleButton.click();
      await waitFor(
        () => Boolean(document.querySelector(".batch-process-badge")?.textContent?.includes(`${1 + RAW_SAMPLES.length}/${1 + RAW_SAMPLES.length}`)),
        "batch AI style completed",
        45000
      );
      await selectAsset(0, "JPG");
      const jpgSummary = document.querySelector(".summary-box")?.textContent ?? "";
      if (!jpgSummary.includes("批量 AI 追色")) throw new Error("JPG summary does not show batch AI style");
      for (let index = 0; index < RAW_SAMPLES.length; index += 1) {
        await selectAsset(index + 1, RAW_SAMPLES[index].label);
        const rawSummary = document.querySelector(".summary-box")?.textContent ?? "";
        if (!rawSummary.includes("批量 AI 追色")) throw new Error(`${RAW_SAMPLES[index].label} summary does not show batch AI style`);
      }
      report.summary.batchAiStyleApplied = true;
      await waitForBatchIdle();
      return "Batch AI style summaries present on JPG, Nikon RAW and Sony RAW";
    });

    await runStep(report, "run queued batch export for JPG and RAW previews", async () => {
      await openAccordion("accordion-export-trigger", "export");
      const cleanup = installDownloadCapture(report.summary.exportedNames);
      try {
        await waitFor(
          () =>
            Boolean(
              Array.from(document.querySelectorAll("button")).find(
                (candidate) => candidate.textContent?.includes("批量导出") && !(candidate as HTMLButtonElement).disabled
              )
            ),
          "batch export button enabled"
        );
        const exportButton = Array.from(document.querySelectorAll("button")).find(
          (candidate) => candidate.textContent?.includes("批量导出") && !(candidate as HTMLButtonElement).disabled
        ) as HTMLButtonElement | undefined;
        if (!exportButton) throw new Error("Batch export button unavailable");
        exportButton.click();
        await waitFor(() => report.summary.exportedNames.length === 1 + RAW_SAMPLES.length, "three queued JPG downloads", 60000);
      } finally {
        cleanup();
      }
      report.summary.exportedCount = report.summary.exportedNames.length;
      if (!report.summary.exportedNames.every((name) => name.endsWith(".jpg"))) {
        throw new Error(`Unexpected export names: ${report.summary.exportedNames.join(", ")}`);
      }
      return `Queued export downloaded ${report.summary.exportedNames.join(", ")}`;
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
