import { spawn } from "node:child_process";

const args = ["test", "export_file_conflict_strategies_write_expected_files", "--", "--nocapture"];

const child = spawn("cargo", args, {
  cwd: new URL("../src-tauri/", import.meta.url),
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error(`Failed to start cargo export conflict check: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code) => {
  if (code !== 0) {
    console.error(`cargo ${args.join(" ")} failed with exit code ${code}`);
    process.exit(code ?? 1);
  }
  console.log("CHECK_EXPORT_CONFLICTS_OK");
});
