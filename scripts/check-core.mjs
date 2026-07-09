import { spawn } from "node:child_process";

const npmCommand = "npm";

const steps = [
  ["run", "typecheck"],
  ["run", "check:ai-safety"],
  ["run", "check:ai-settings-ux"],
  ["run", "check:compare-layout-ux"],
  ["run", "check:raw-preview"],
  ["run", "check:desktop-import-payload"],
  ["run", "check:import-drop-ux"],
  ["run", "check:jpg-fixtures"],
  ["run", "check:manual-acceptance"],
  ["run", "check:parameter-inputs"],
  ["run", "check:performance-diagnostics"],
  ["run", "check:export-exif-fixtures"],
  ["run", "check:export-target-ux"],
  ["run", "check:export-conflicts"],
  ["run", "check:export-queue"],
  ["run", "check:presets"],
  ["run", "check:preset-render"],
  ["run", "check:preset-contact-sheets"],
  ["run", "build"],
  ["run", "generate:release-evidence"],
  ["run", "generate:release-readiness"],
  ["run", "check:privacy"]
];

const runStep = (args) =>
  new Promise((resolve, reject) => {
    const label = `npm ${args.join(" ")}`;
    console.log(`\n[check:core] ${label}`);
    const child = spawn(npmCommand, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });

for (const step of steps) {
  await runStep(step);
}

console.log("\nCHECK_CORE_OK");
