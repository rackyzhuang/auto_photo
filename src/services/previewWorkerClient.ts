import type { EditParams, ExportSettings, PhotoAsset } from "../types";
import { renderEditedPreview } from "./imageProcessing";

interface WorkerResponse {
  id: number;
  dataUrl?: string;
  error?: string;
}

interface PendingRender {
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
  abortHandler?: () => void;
}

let worker: Worker | undefined;
let nextRequestId = 1;
const pending = new Map<number, PendingRender>();

const createPreviewAbortError = () => new DOMException("Preview request cancelled", "AbortError");

const removePending = (id: number) => {
  const request = pending.get(id);
  if (!request) return undefined;
  pending.delete(id);
  return request;
};

const rejectPending = (id: number, reason: unknown) => {
  const request = removePending(id);
  if (!request) return;
  request.abortHandler?.();
  request.reject(reason);
};

const rejectAllPending = (reason: unknown) => {
  pending.forEach((request) => {
    request.abortHandler?.();
    request.reject(reason);
  });
  pending.clear();
};

const resetWorker = () => {
  worker?.terminate();
  worker = undefined;
};

const canUsePreviewWorker = () =>
  typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined";

const getWorker = () => {
  if (!canUsePreviewWorker()) return undefined;
  if (!worker) {
    worker = new Worker(new URL("../workers/previewWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const request = removePending(event.data.id);
      if (!request) return;
      request.abortHandler?.();
      if (event.data.dataUrl) request.resolve(event.data.dataUrl);
      else request.reject(new Error(event.data.error ?? "Worker preview failed"));
    };
    worker.onerror = (event) => {
      rejectAllPending(new Error(event.message || "Worker preview failed"));
      resetWorker();
    };
  }
  return worker;
};

export const renderPreviewWithWorkerFallback = async (
  asset: PhotoAsset,
  edits: EditParams,
  options: { maxEdge?: number; quality?: number; exportSettings?: ExportSettings; signal?: AbortSignal } = {}
) => {
  if (!asset.isEditable) throw new Error("RAW preview rendering is not connected yet");
  if (options.signal?.aborted) throw createPreviewAbortError();
  const previewWorker = getWorker();
  if (!previewWorker) return renderEditedPreview(asset, edits, options);

  try {
    const id = nextRequestId;
    nextRequestId += 1;
    const result = new Promise<string>((resolve, reject) => {
      const onAbort = () => {
        const abortError = createPreviewAbortError();
        rejectPending(id, abortError);
        rejectAllPending(abortError);
        resetWorker();
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      pending.set(id, {
        resolve,
        reject,
        abortHandler: () => {
          options.signal?.removeEventListener("abort", onAbort);
        }
      });
      previewWorker.postMessage({
        id,
        file: asset.file,
        metadata: asset.metadata,
        edits,
        maxEdge: options.maxEdge ?? 1800,
        quality: options.quality ?? 0.9,
        exportSettings: options.exportSettings
      });
    });
    return await result;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return renderEditedPreview(asset, edits, options);
  }
};

export const disposePreviewWorker = () => {
  rejectAllPending(new Error("Worker closed"));
  resetWorker();
};
