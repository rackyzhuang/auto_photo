import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const workspace = process.cwd();
const scannerPath = path.join(workspace, "src", "services", "rawEmbeddedJpeg.ts");
const source = fs.readFileSync(scannerPath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;

const scanner = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

const samples = [
  {
    path: path.join(workspace, "image", "nikon", "DSC_2156.NEF"),
    minWidth: 6000,
    minHeight: 4000
  },
  {
    path: path.join(workspace, "image", "sony", "20230813-0192.ARW"),
    minWidth: 9000,
    minHeight: 6000
  }
];

const results = [];
let failed = false;

for (const sample of samples) {
  const data = fs.readFileSync(sample.path).subarray(0, scanner.RAW_JPEG_SCAN_LIMIT);
  const candidates = scanner.findEmbeddedJpegCandidates(new Uint8Array(data));
  const best = candidates[0];
  const passed = Boolean(best && best.width >= sample.minWidth && best.height >= sample.minHeight);
  failed ||= !passed;
  results.push({
    file: path.relative(workspace, sample.path),
    candidateCount: candidates.length,
    passed,
    best: best
      ? {
          start: best.start,
          length: best.length,
          width: best.width,
          height: best.height
        }
      : undefined
  });
}

console.log(JSON.stringify({ status: failed ? "failed" : "passed", results }, null, 2));
if (failed) process.exitCode = 1;
