import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const workspace = process.cwd();

const transpileTsModule = async (relativePath) => {
  const source = fs.readFileSync(path.join(workspace, relativePath), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove
    }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);
};

const { runExportQueue } = await transpileTsModule("src/services/exportQueue.ts");

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const createAsset = (id, name) => ({
  id,
  name,
  file: {},
  fileHash: `${id}-hash`,
  size: 10,
  type: "image/jpeg",
  sourceFormat: "jpg",
  isEditable: true,
  objectUrl: "",
  previewUrl: "",
  previewKind: "jpg",
  cameraBrand: "Unknown",
  metadata: {},
  edits: {}
});

const createHarness = ({
  queueItems,
  mode = "batch",
  outputDir = "exports",
  writeItem,
  isCancelled = () => false,
  isAbortError = (error) => error?.name === "AbortError"
}) => {
  const history = [];
  const statuses = [];
  const progress = {
    starts: [],
    current: [],
    completed: 0,
    failedSnapshots: [],
    stops: []
  };

  const run = () =>
    runExportQueue({
      mode,
      queueItems,
      outputDir,
      waitBetweenItemsMs: 0,
      labels: {
        start: "start",
        item: (item, position, total) => `item ${position}/${total} ${item.asset.name}`,
        cancelled: (completedCount, total) => `cancelled ${completedCount}/${total}`,
        completed: (result) => `done ${result.completedCount}/${result.totalCount}`
      },
      writeItem,
      getRequestedName: (item) => `${item.asset.name}.jpg`,
      recordHistory: async (job) => {
        history.push(job);
      },
      isCancelled,
      isAbortError,
      setStatus: (message) => statuses.push(message),
      onProgressStart: (total) => progress.starts.push(total),
      onProgressCurrent: (assetName) => progress.current.push(assetName),
      onProgressCompleted: () => {
        progress.completed += 1;
      },
      onProgressFailed: (failed) => progress.failedSnapshots.push(failed),
      onProgressStop: (failed) => progress.stops.push(failed)
    });

  return { history, statuses, progress, run };
};

const runCompletedScenario = async () => {
  const queueItems = [
    { asset: createAsset("a1", "one"), index: 0 },
    { asset: createAsset("a2", "two"), index: 1 }
  ];
  const harness = createHarness({
    queueItems,
    writeItem: async (item) => ({
      skipped: item.asset.id === "a2",
      requestedName: `${item.asset.name}.jpg`,
      outputName: item.asset.id === "a2" ? `${item.asset.name}.jpg` : `${item.asset.name}_out.jpg`,
      outputPath: `exports/${item.asset.name}.jpg`
    })
  });

  const result = await harness.run();

  assert(result.status === "completed", "completed scenario should finish as completed");
  assert(result.totalCount === 2, "completed scenario totalCount mismatch");
  assert(result.completedCount === 2, "skipped items should count as completed");
  assert(result.skippedCount === 1, "skippedCount should include skipped items");
  assert(result.items[0].status === "written", "first item should be written");
  assert(result.items[1].status === "skipped", "second item should be skipped");
  assert(harness.progress.completed === 2, "progress completed should include written and skipped items");
  assert(harness.history.length === 1, "completed scenario should record one history job");
  assert(harness.history[0].failedCount === 0, "completed history failedCount mismatch");

  return { name: "completed_with_skip", result };
};

const runPartialFailureScenario = async () => {
  const queueItems = [
    { asset: createAsset("a1", "one"), index: 0 },
    { asset: createAsset("a2", "two"), index: 1 },
    { asset: createAsset("a3", "three"), index: 2 }
  ];
  const harness = createHarness({
    queueItems,
    writeItem: async (item) => {
      if (item.asset.id === "a2") {
        throw new Error("disk full");
      }
      return {
        skipped: false,
        requestedName: `${item.asset.name}.jpg`,
        outputName: `${item.asset.name}_out.jpg`
      };
    }
  });

  const result = await harness.run();

  assert(result.status === "completed_with_failures", "partial failure should finish as completed_with_failures");
  assert(result.completedCount === 2, "partial failure completedCount mismatch");
  assert(result.failed.length === 1, "partial failure should have one failed item");
  assert(result.failed[0].reason === "disk full", "partial failure reason mismatch");
  assert(result.items[1].status === "failed", "failed item should be recorded in items");
  assert(harness.progress.failedSnapshots.length === 1, "progress failed snapshot should be emitted");
  assert(harness.history[0].status === "completed_with_failures", "history status mismatch");

  return { name: "partial_failure", result };
};

const runAllFailedScenario = async () => {
  const queueItems = [
    { asset: createAsset("a1", "one"), index: 0 },
    { asset: createAsset("a2", "two"), index: 1 }
  ];
  const harness = createHarness({
    queueItems,
    writeItem: async () => {
      throw new Error("write denied");
    }
  });

  const result = await harness.run();

  assert(result.status === "failed", "all failed scenario should finish as failed");
  assert(result.completedCount === 0, "all failed completedCount mismatch");
  assert(result.failed.length === 2, "all failed scenario should track both failures");
  assert(harness.history[0].failedCount === 2, "all failed history failedCount mismatch");
  assert(harness.statuses.at(-1) === "done 0/2", "all failed final status should use completed label");

  return { name: "all_failed", result };
};

const runCancelledScenario = async () => {
  const queueItems = [
    { asset: createAsset("a1", "one"), index: 0 },
    { asset: createAsset("a2", "two"), index: 1 },
    { asset: createAsset("a3", "three"), index: 2 }
  ];
  let cancelChecks = 0;
  const written = [];
  const harness = createHarness({
    queueItems,
    isCancelled: () => {
      cancelChecks += 1;
      return cancelChecks > 1;
    },
    writeItem: async (item) => {
      written.push(item.asset.id);
      return {
        skipped: false,
        requestedName: `${item.asset.name}.jpg`,
        outputName: `${item.asset.name}_out.jpg`
      };
    }
  });

  const result = await harness.run();

  assert(result.status === "cancelled", "cancelled scenario should finish as cancelled");
  assert(result.completedCount === 1, "cancelled scenario should keep completed item count");
  assert(written.length === 1, "cancelled scenario should not start later queue items");
  assert(harness.history[0].status === "cancelled", "cancelled history status mismatch");
  assert(harness.statuses.at(-1) === "cancelled 1/3", "cancelled status message mismatch");

  return { name: "cancelled_between_items", result };
};

const runAbortScenario = async () => {
  const queueItems = [
    { asset: createAsset("a1", "one"), index: 0 },
    { asset: createAsset("a2", "two"), index: 1 }
  ];
  const abortError = new Error("aborted");
  abortError.name = "AbortError";
  const harness = createHarness({
    queueItems,
    writeItem: async () => {
      throw abortError;
    }
  });

  const result = await harness.run();

  assert(result.status === "cancelled", "abort scenario should finish as cancelled");
  assert(result.completedCount === 0, "abort scenario completedCount mismatch");
  assert(result.failed.length === 0, "abort scenario should not record abort as failure");
  assert(result.items.length === 0, "abort scenario should not record aborted item as failed");
  assert(harness.history[0].status === "cancelled", "abort history status mismatch");

  return { name: "abort_error", result };
};

const scenarios = [];
for (const runScenario of [
  runCompletedScenario,
  runPartialFailureScenario,
  runAllFailedScenario,
  runCancelledScenario,
  runAbortScenario
]) {
  scenarios.push(await runScenario());
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      scenarios: scenarios.map(({ name, result }) => ({
        name,
        status: result.status,
        totalCount: result.totalCount,
        completedCount: result.completedCount,
        failedCount: result.failed.length,
        skippedCount: result.skippedCount,
        itemStatuses: result.items.map((item) => item.status)
      }))
    },
    null,
    2
  )
);
