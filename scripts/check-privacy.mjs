import fs from "node:fs";
import path from "node:path";

const workspace = process.cwd();
const maxTextFileBytes = 2 * 1024 * 1024;

const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".rs",
  ".toml",
  ".ts",
  ".tsx"
]);

const skipDirectoryNames = new Set([".git", "node_modules", "target"]);
const skipFileNames = new Set(["openAi.json"]);

const joinPattern = (...parts) => parts.join("");
const secretPatterns = [
  {
    label: "openai-style-key",
    pattern: new RegExp(`${joinPattern("s", "k")}-[A-Za-z0-9]{20,}`, "g")
  },
  {
    label: "bearer-token",
    pattern: new RegExp(`${joinPattern("Bear", "er")}\\s+[A-Za-z0-9._-]{20,}`, "gi")
  },
  {
    label: "api-key-env-assignment",
    pattern: new RegExp(`${["OPENAI", "API", "KEY"].join("_")}\\s*=`, "g")
  },
  {
    label: "private-endpoint-domain",
    pattern: new RegExp(joinPattern("fco", "dex", "\\.", "top"), "gi")
  }
];

const productionIsolationTerms = [
  "openAi.json",
  "diagnostics",
  "phase5",
  "keyring-smoke",
  "must-not-show"
];

const collectFiles = (entryPath) => {
  if (!fs.existsSync(entryPath)) return [];
  const stat = fs.statSync(entryPath);
  if (stat.isDirectory()) {
    const name = path.basename(entryPath);
    if (skipDirectoryNames.has(name)) return [];
    return fs
      .readdirSync(entryPath)
      .flatMap((child) => collectFiles(path.join(entryPath, child)));
  }
  if (!stat.isFile()) return [];
  if (skipFileNames.has(path.basename(entryPath))) return [];
  if (stat.size > maxTextFileBytes) return [];
  if (!textExtensions.has(path.extname(entryPath))) return [];
  return [entryPath];
};

const scanFile = (filePath, checks) => {
  const text = fs.readFileSync(filePath, "utf8");
  return checks
    .filter((check) => {
      check.pattern.lastIndex = 0;
      return check.pattern.test(text);
    })
    .map((check) => ({
      file: path.relative(workspace, filePath),
      label: check.label
    }));
};

const secretTargets = [
  "dist",
  "src",
  path.join("src-tauri", "src"),
  "scripts",
  "remark",
  "remark-V2",
  "README.md",
  "README_CN.md",
  "package.json"
];

const secretFiles = secretTargets.flatMap((target) => collectFiles(path.join(workspace, target)));
const secretFindings = secretFiles.flatMap((filePath) => scanFile(filePath, secretPatterns));

const distFiles = collectFiles(path.join(workspace, "dist"));
const isolationChecks = productionIsolationTerms.map((term) => ({
  label: `dist-term:${term}`,
  pattern: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
}));
const isolationFindings = distFiles.flatMap((filePath) => scanFile(filePath, isolationChecks));

const status = secretFindings.length === 0 && isolationFindings.length === 0 ? "passed" : "failed";

console.log(
  JSON.stringify(
    {
      status,
      scannedSecretFiles: secretFiles.length,
      scannedDistFiles: distFiles.length,
      secretFindingCount: secretFindings.length,
      isolationFindingCount: isolationFindings.length,
      findings: [...secretFindings, ...isolationFindings]
    },
    null,
    2
  )
);

if (status !== "passed") {
  process.exitCode = 1;
}
