import type { ExportJobRecord, ExportProgress, PhotoAsset } from "../types";

export interface ExportWriteResult {
  skipped: boolean;
  requestedName: string;
  outputName: string;
  outputPath?: string;
}

export interface ExportQueueItem {
  asset: PhotoAsset;
  index: number;
}

export interface ExportQueueResult {
  status: ExportJobRecord["status"];
  totalCount: number;
  completedCount: number;
  failed: ExportProgress["failed"];
  items: NonNullable<ExportJobRecord["items"]>;
  skippedCount: number;
}

interface ExportQueueLabels {
  start: string;
  item: (item: ExportQueueItem, position: number, total: number) => string;
  cancelled: (completedCount: number, total: number) => string;
  completed: (result: ExportQueueResult) => string;
}

interface RunExportQueueOptions {
  mode: ExportJobRecord["mode"];
  queueItems: ExportQueueItem[];
  outputDir?: string;
  signal?: AbortSignal;
  labels: ExportQueueLabels;
  writeItem: (item: ExportQueueItem, signal?: AbortSignal) => Promise<ExportWriteResult>;
  getRequestedName: (item: ExportQueueItem) => string;
  recordHistory: (job: ExportJobRecord) => Promise<void>;
  isCancelled: () => boolean;
  isAbortError: (error: unknown) => boolean;
  setStatus: (message: string) => void;
  onProgressStart: (total: number) => void;
  onProgressCurrent: (assetName?: string) => void;
  onProgressCompleted: () => void;
  onProgressFailed: (failed: ExportProgress["failed"]) => void;
  onProgressStop: (failed: ExportProgress["failed"]) => void;
  waitBetweenItemsMs?: number;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createExportItemRecord = (
  item: ExportQueueItem,
  result: ExportWriteResult
): NonNullable<ExportJobRecord["items"]>[number] => ({
  assetId: item.asset.id,
  name: item.asset.name,
  status: result.skipped ? "skipped" : "written",
  requestedName: result.requestedName,
  outputName: result.outputName,
  outputPath: result.outputPath
});

const createFailedExportItemRecord = (
  item: ExportQueueItem,
  requestedName: string,
  reason: string
): NonNullable<ExportJobRecord["items"]>[number] => ({
  assetId: item.asset.id,
  name: item.asset.name,
  status: "failed",
  requestedName,
  reason
});

const countCompletedExportItems = (items: NonNullable<ExportJobRecord["items"]>) =>
  items.filter((item) => item.status !== "failed").length;

const createResult = (
  status: ExportJobRecord["status"],
  totalCount: number,
  failed: ExportProgress["failed"],
  items: NonNullable<ExportJobRecord["items"]>,
  skippedCount: number
): ExportQueueResult => ({
  status,
  totalCount,
  completedCount: countCompletedExportItems(items),
  failed,
  items,
  skippedCount
});

const recordResult = async (
  options: RunExportQueueOptions,
  result: ExportQueueResult
) => {
  await options.recordHistory({
    mode: options.mode,
    status: result.status,
    totalCount: result.totalCount,
    completedCount: result.completedCount,
    failedCount: result.failed.length,
    outputDir: options.outputDir,
    items: result.items,
    failed: result.failed
  });
};

const finishCancelled = async (
  options: RunExportQueueOptions,
  failed: ExportProgress["failed"],
  items: NonNullable<ExportJobRecord["items"]>,
  skippedCount: number
) => {
  const result = createResult("cancelled", options.queueItems.length, failed, items, skippedCount);
  options.setStatus(options.labels.cancelled(result.completedCount, options.queueItems.length));
  options.onProgressStop(failed);
  await recordResult(options, result);
  return result;
};

export const runExportQueue = async (options: RunExportQueueOptions): Promise<ExportQueueResult> => {
  const failed: ExportProgress["failed"] = [];
  const exportItems: NonNullable<ExportJobRecord["items"]> = [];
  let skippedCount = 0;

  options.setStatus(options.labels.start);
  options.onProgressStart(options.queueItems.length);

  for (let position = 0; position < options.queueItems.length; position += 1) {
    const queueItem = options.queueItems[position];
    const { asset } = queueItem;

    if (options.isCancelled()) {
      return finishCancelled(options, failed, exportItems, skippedCount);
    }

    options.setStatus(options.labels.item(queueItem, position + 1, options.queueItems.length));
    options.onProgressCurrent(asset.name);

    try {
      const writeResult = await options.writeItem(queueItem, options.signal);
      if (writeResult.skipped) skippedCount += 1;
      exportItems.push(createExportItemRecord(queueItem, writeResult));
      options.onProgressCompleted();
    } catch (error) {
      if (options.isAbortError(error)) {
        return finishCancelled(options, failed, exportItems, skippedCount);
      }
      const reason = error instanceof Error ? error.message : "导出失败";
      failed.push({ assetId: asset.id, name: asset.name, reason });
      exportItems.push(createFailedExportItemRecord(queueItem, options.getRequestedName(queueItem), reason));
      options.onProgressFailed([...failed]);
    }

    if (position < options.queueItems.length - 1) {
      await wait(options.waitBetweenItemsMs ?? 180);
    }
  }

  const completedCount = countCompletedExportItems(exportItems);
  const status: ExportJobRecord["status"] =
    failed.length === 0 ? "completed" : completedCount === 0 ? "failed" : "completed_with_failures";
  const result = createResult(status, options.queueItems.length, failed, exportItems, skippedCount);

  options.onProgressStop(failed);
  await recordResult(options, result);
  options.setStatus(options.labels.completed(result));
  return result;
};
