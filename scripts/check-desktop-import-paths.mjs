import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..");
const tauriRoot = path.join(workspaceRoot, "src-tauri");

const fixtures = [
  {
    label: "nikon-embedded-jpg",
    relativePath: path.join("image", "generated-jpg", "nikon-DSC_2156-embedded.jpg"),
    minBytes: 1024
  },
  {
    label: "nikon-raw-nef",
    relativePath: path.join("image", "nikon", "DSC_2156.NEF"),
    minBytes: 1024
  },
  {
    label: "sony-raw-arw",
    relativePath: path.join("image", "sony", "20230813-0192.ARW"),
    minBytes: 1024
  }
];

const findings = [];
const fixturePaths = [];
const fixtureSummary = [];

for (const fixture of fixtures) {
  const absolutePath = path.join(workspaceRoot, fixture.relativePath);
  if (!fs.existsSync(absolutePath)) {
    findings.push(`${fixture.label} missing at ${fixture.relativePath}`);
    continue;
  }

  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    findings.push(`${fixture.label} is not a file at ${fixture.relativePath}`);
    continue;
  }
  if (stat.size < fixture.minBytes) {
    findings.push(`${fixture.label} is too small: ${stat.size} bytes`);
    continue;
  }

  fixturePaths.push(absolutePath);
  fixtureSummary.push({
    label: fixture.label,
    relativePath: fixture.relativePath.replaceAll(path.sep, "/"),
    bytes: stat.size
  });
}

if (findings.length > 0) {
  console.error("CHECK_DESKTOP_IMPORT_PATHS_FAILED");
  console.error(JSON.stringify({ findings, fixtureSummary }, null, 2));
  process.exit(1);
}

const env = {
  ...process.env,
  AUTO_PHOTO_REAL_DESKTOP_IMPORT_PATHS: fixturePaths.join(";")
};

const cargoArgs = [
  "test",
  "real_photo_files_read_desktop_import_paths_when_configured",
  "--",
  "--nocapture"
];

console.log("[check:desktop-import-paths] fixture summary:");
console.log(JSON.stringify(fixtureSummary, null, 2));
console.log("[check:desktop-import-paths] cargo " + cargoArgs.join(" "));

let cargoOutput = "";
const exitCode = await new Promise((resolve, reject) => {
  const child = spawn("cargo", cargoArgs, {
    cwd: tauriRoot,
    env,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    cargoOutput += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    cargoOutput += text;
    process.stderr.write(text);
  });
  child.on("error", reject);
  child.on("exit", (code) => resolve(code ?? 1));
});

if (exitCode !== 0) {
  console.error(`CHECK_DESKTOP_IMPORT_PATHS_FAILED cargo exited with ${exitCode}`);
  process.exit(exitCode);
}

if (!cargoOutput.includes("real_photo_files_read_desktop_import_paths_when_configured")) {
  console.error("CHECK_DESKTOP_IMPORT_PATHS_FAILED target Rust test was not executed");
  process.exit(1);
}

console.log("CHECK_DESKTOP_IMPORT_PATHS_OK");
