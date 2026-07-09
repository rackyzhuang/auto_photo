import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const workspace = process.cwd();
const sourcePath = path.join(workspace, "src", "services", "desktopImportPayload.ts");
const source = fs.readFileSync(sourcePath, "utf8").replace(/import\s+type\s+\{[^}]+\}\s+from\s+"\.\/desktopBridge";\s*/g, "");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;

const { desktopPhotoPayloadToFile } = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const toBase64 = (value) => Buffer.from(value).toString("base64");

const cases = [
  {
    name: "jpg payload preserves file fields",
    sample: {
      name: "nikon-sample.jpg",
      path: "C:/samples/nikon-sample.jpg",
      size: 4,
      mimeType: "image/jpeg",
      dataBase64: toBase64([0xff, 0xd8, 0xff, 0xd9])
    },
    expected: { name: "nikon-sample.jpg", size: 4, type: "image/jpeg", lastModified: 1234 }
  },
  {
    name: "raw payload preserves raw mime",
    sample: {
      name: "DSC_2156.NEF",
      path: "C:/samples/DSC_2156.NEF",
      size: 6,
      mimeType: "image/x-nikon-nef",
      dataBase64: toBase64([0x4e, 0x69, 0x6b, 0x6f, 0x6e, 0x00])
    },
    expected: { name: "DSC_2156.NEF", size: 6, type: "image/x-nikon-nef", lastModified: 1234 }
  }
];

const results = [];

for (const testCase of cases) {
  const file = desktopPhotoPayloadToFile(testCase.sample, { lastModified: testCase.expected.lastModified });
  assert(file.name === testCase.expected.name, `${testCase.name}: name mismatch`);
  assert(file.size === testCase.expected.size, `${testCase.name}: size mismatch`);
  assert(file.type === testCase.expected.type, `${testCase.name}: type mismatch`);
  assert(file.lastModified === testCase.expected.lastModified, `${testCase.name}: lastModified mismatch`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  assert(bytes.length === testCase.expected.size, `${testCase.name}: arrayBuffer size mismatch`);
  results.push({
    name: testCase.name,
    fileName: file.name,
    size: file.size,
    type: file.type
  });
}

const failures = [
  {
    name: "empty payload rejects",
    sample: { name: "empty.NEF", path: "C:/samples/empty.NEF", size: 10, mimeType: "image/x-nikon-nef", dataBase64: "" },
    message: "读取结果为空"
  },
  {
    name: "size mismatch rejects",
    sample: { name: "short.ARW", path: "C:/samples/short.ARW", size: 10, mimeType: "image/x-sony-arw", dataBase64: toBase64([1, 2, 3]) },
    message: "读取字节数不一致"
  }
];

for (const testCase of failures) {
  let rejected = false;
  try {
    desktopPhotoPayloadToFile(testCase.sample, { lastModified: 1234 });
  } catch (error) {
    rejected = error instanceof Error && error.message.includes(testCase.message);
  }
  assert(rejected, `${testCase.name}: expected rejection containing ${testCase.message}`);
  results.push({ name: testCase.name, rejected: true });
}

console.log(JSON.stringify({ status: "passed", cases: results }, null, 2));
