import fs from "node:fs";
import path from "node:path";

const workspace = process.cwd();
const evidencePath = path.join(workspace, "remark-V2", "artifacts", "release-evidence.json");
const manualPath = path.join(workspace, "remark-V2", "manual-acceptance-results.json");
const readinessJsonPath = path.join(workspace, "remark-V2", "artifacts", "release-readiness.json");
const readinessMarkdownPath = path.join(workspace, "remark-V2", "07-release-readiness.md");
const sensitivePattern = /(https?:\/\/|Bearer\s+|sk-[A-Za-z0-9_-]{8,}|data:image\/[^;]+;base64,)/i;

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const countByStatus = (items) => {
  const counts = { pending: 0, passed: 0, failed: 0, blocked: 0 };
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
};

const evidence = readJson(evidencePath);
const manual = readJson(manualPath);
const manualCounts = countByStatus(manual.items ?? []);
const pendingItems = (manual.items ?? []).filter((item) => item.status === "pending");
const failedItems = (manual.items ?? []).filter((item) => item.status === "failed");
const blockedItems = (manual.items ?? []).filter((item) => item.status === "blocked");
const automatedPassed =
  (evidence.artifacts ?? []).every((artifact) => artifact.exists) &&
  (evidence.diagnostics ?? []).length >= 5 &&
  evidence.privacy?.evidenceContainsSecretLookingContent === false;
const manualComplete = manual.completionStatus === "complete" && pendingItems.length === 0 && failedItems.length === 0 && blockedItems.length === 0;
const releaseReadiness = automatedPassed && manualComplete ? "ready" : "incomplete";

const readiness = {
  generatedAt: new Date().toISOString(),
  releaseReadiness,
  automatedStatus: automatedPassed ? "passed" : "failed",
  manualAcceptanceStatus: manual.completionStatus,
  artifactCount: evidence.artifacts?.length ?? 0,
  diagnosticCount: evidence.diagnostics?.length ?? 0,
  manualCounts,
  blockers: [
    ...pendingItems.map((item) => ({
      id: item.id,
      status: item.status,
      platform: item.platform,
      category: item.category,
      scope: item.scope
    })),
    ...failedItems.map((item) => ({
      id: item.id,
      status: item.status,
      platform: item.platform,
      category: item.category,
      scope: item.scope
    })),
    ...blockedItems.map((item) => ({
      id: item.id,
      status: item.status,
      platform: item.platform,
      category: item.category,
      scope: item.scope
    }))
  ],
  nextActions: [
    "Run Windows release exe manual file picker and drag/drop acceptance.",
    "Run Windows MSI and NSIS interactive installer acceptance.",
    "Run right-side AI button manual acceptance.",
    "Run a longer manual Windows editing/export/AI session.",
    "Run macOS app/dmg, Keychain and Finder drag/drop acceptance."
  ],
  evidence: {
    releaseEvidence: "remark-V2/artifacts/release-evidence.json",
    manualAcceptanceResults: "remark-V2/manual-acceptance-results.json",
    manualRunbook: "remark-V2/06-manual-acceptance-runbook.md"
  }
};

const markdownLines = [
  "# 发布就绪审计",
  "",
  `更新时间：${readiness.generatedAt}`,
  "",
  "## 当前结论",
  "",
  `- 发布就绪状态：\`${readiness.releaseReadiness}\``,
  `- 自动化证据状态：\`${readiness.automatedStatus}\``,
  `- 人工验收状态：\`${readiness.manualAcceptanceStatus}\``,
  `- 发布产物数量：${readiness.artifactCount}`,
  `- 关键诊断摘要数量：${readiness.diagnosticCount}`,
  `- 人工验收 pending：${manualCounts.pending}`,
  `- 人工验收 failed：${manualCounts.failed}`,
  `- 人工验收 blocked：${manualCounts.blocked}`,
  "",
  "## 阻塞发布的剩余项",
  "",
  ...readiness.blockers.map((item) => `- \`${item.id}\`：${item.platform} / ${item.category} / ${item.scope}`),
  "",
  "## 下一步",
  "",
  ...readiness.nextActions.map((action) => `- ${action}`),
  "",
  "## 证据文件",
  "",
  `- Release evidence：\`${readiness.evidence.releaseEvidence}\``,
  `- Manual acceptance results：\`${readiness.evidence.manualAcceptanceResults}\``,
  `- Manual runbook：\`${readiness.evidence.manualRunbook}\``,
  "",
  "## 隐私边界",
  "",
  "- 本报告不记录 API key、私有 Base URL、authorization token、远端响应正文或图片 data URL。",
  "- AI 结果只应记录脱敏状态、模型名和参数字段。",
  ""
];

const jsonText = JSON.stringify(readiness, null, 2);
const markdownText = `${markdownLines.join("\n")}\n`;
const combined = `${jsonText}\n${markdownText}`;
if (sensitivePattern.test(combined)) {
  console.error("release readiness report contains secret-looking content");
  process.exit(1);
}

fs.mkdirSync(path.dirname(readinessJsonPath), { recursive: true });
fs.writeFileSync(readinessJsonPath, `${jsonText}\n`, "utf8");
fs.writeFileSync(readinessMarkdownPath, markdownText, "utf8");

console.log(
  JSON.stringify(
    {
      status: "passed",
      releaseReadiness,
      automatedStatus: readiness.automatedStatus,
      manualAcceptanceStatus: readiness.manualAcceptanceStatus,
      blockerCount: readiness.blockers.length,
      readinessJsonPath,
      readinessMarkdownPath
    },
    null,
    2
  )
);
