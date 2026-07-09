import fs from "node:fs";
import path from "node:path";

const workspace = process.cwd();
const resultsPath = path.join(workspace, "remark-V2", "manual-acceptance-results.json");
const sensitivePattern = /(https?:\/\/|Bearer\s+|sk-[A-Za-z0-9_-]{8,}|data:image\/[^;]+;base64,)/i;
const statuses = new Set(["pending", "passed", "failed", "blocked"]);
const categories = new Set([
  "import-picker",
  "drag-drop",
  "raw-preview",
  "compare-layout",
  "export-target",
  "ai-connection",
  "ai-tuning",
  "installer",
  "privacy",
  "macos-permission",
  "performance"
]);

const findings = [];
if (!fs.existsSync(resultsPath)) {
  findings.push(`missing ${resultsPath}`);
} else {
  const raw = fs.readFileSync(resultsPath, "utf8");
  if (sensitivePattern.test(raw)) {
    findings.push("manual acceptance results contain secret-looking content");
  }
  const parsed = JSON.parse(raw);
  if (parsed.schemaVersion !== 1) findings.push("schemaVersion must be 1");
  if (!["complete", "incomplete"].includes(parsed.completionStatus)) {
    findings.push("completionStatus must be complete or incomplete");
  }
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    findings.push("items must be a non-empty array");
  }

  const ids = new Set();
  for (const [index, item] of (parsed.items ?? []).entries()) {
    const label = item?.id ?? `item-${index}`;
    for (const field of ["id", "phase", "platform", "category", "status", "artifact", "scope"]) {
      if (!item?.[field] || typeof item[field] !== "string") findings.push(`${label}: missing string ${field}`);
    }
    if (item?.id) {
      if (ids.has(item.id)) findings.push(`${item.id}: duplicate id`);
      ids.add(item.id);
    }
    if (item?.status && !statuses.has(item.status)) findings.push(`${label}: invalid status ${item.status}`);
    if (item?.category && !categories.has(item.category)) findings.push(`${label}: invalid category ${item.category}`);
    if (!Array.isArray(item?.expectedEvidence) || item.expectedEvidence.length === 0) {
      findings.push(`${label}: expectedEvidence must be a non-empty array`);
    }
    if (!item?.evidence || typeof item.evidence !== "object" || Array.isArray(item.evidence)) {
      findings.push(`${label}: evidence must be an object`);
    }
    if (item?.status === "passed") {
      for (const expected of item.expectedEvidence ?? []) {
        if (!Object.hasOwn(item.evidence ?? {}, expected)) {
          findings.push(`${label}: passed item missing evidence.${expected}`);
        }
      }
    }
    if (item?.status === "failed" && !item?.failureCategory) {
      findings.push(`${label}: failed item must include failureCategory`);
    }
  }

  const counts = Object.fromEntries([...statuses].map((status) => [status, 0]));
  for (const item of parsed.items ?? []) counts[item.status] = (counts[item.status] ?? 0) + 1;
  const completionStatus = counts.pending === 0 && counts.failed === 0 && counts.blocked === 0 ? "complete" : "incomplete";
  if (parsed.completionStatus !== completionStatus) {
    findings.push(`completionStatus should be ${completionStatus} for current item statuses`);
  }

  const summary = {
    status: findings.length > 0 ? "failed" : "passed",
    completionStatus,
    itemCount: parsed.items?.length ?? 0,
    counts,
    findings
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (findings.length > 0) {
  if (!findings.some((finding) => finding.startsWith("completionStatus should"))) {
    console.log(JSON.stringify({ status: "failed", findings }, null, 2));
  }
  process.exitCode = 1;
}
