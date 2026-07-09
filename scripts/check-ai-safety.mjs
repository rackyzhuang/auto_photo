import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const workspace = process.cwd();
const sourcePath = path.join(workspace, "src", "services", "aiSafety.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;

const { explainAiFailureReason, sanitizeAiFailureReason } = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
);

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const fakeKey = ["sk", "safetyredactionvalue1234567890"].join("-");
const fakeBearer = ["Bearer", "safety.token.value.1234567890"].join(" ");

const cases = [
  {
    name: "endpoint and token redaction",
    input: `AI failed at https://gateway.example.invalid/v1/chat/completions with ${fakeBearer}`,
    mustInclude: ["AI failed at", "[endpoint]", "Bearer [redacted]"],
    mustNotMatch: [/https?:\/\//i, /safety\.token/i]
  },
  {
    name: "key redaction",
    input: `upstream rejected key ${fakeKey}`,
    mustInclude: ["upstream rejected key", "[redacted-key]"],
    mustNotMatch: [/sk-[A-Za-z0-9]{12,}/]
  },
  {
    name: "empty fallback",
    input: "   \n\t   ",
    equals: "远端 AI 请求失败"
  },
  {
    name: "preserve useful http and json reason",
    input: "AI 接口返回 HTTP 401，AI 接口响应不是有效 JSON",
    mustInclude: ["HTTP 401", "有效 JSON"]
  },
  {
    name: "collapse whitespace and truncate",
    input: `AI    请求失败 ${"x".repeat(260)}`,
    maxLength: 160,
    mustInclude: ["AI 请求失败"]
  }
];

const results = cases.map((testCase) => {
  const output = sanitizeAiFailureReason(testCase.input);
  if (testCase.equals) {
    assert(output === testCase.equals, `${testCase.name}: expected exact fallback`);
  }
  for (const fragment of testCase.mustInclude ?? []) {
    assert(output.includes(fragment), `${testCase.name}: missing ${fragment}`);
  }
  for (const pattern of testCase.mustNotMatch ?? []) {
    assert(!pattern.test(output), `${testCase.name}: leaked pattern ${pattern}`);
  }
  if (testCase.maxLength) {
    assert(output.length <= testCase.maxLength, `${testCase.name}: output too long`);
  }
  return {
    name: testCase.name,
    outputLength: output.length
  };
});

const explanationCases = [
  {
    name: "auth status classification",
    input: "AI 接口返回 HTTP 401",
    category: "API key 或权限异常",
    mustInclude: ["检查 API key", "HTTP 401"]
  },
  {
    name: "endpoint or model classification",
    input: "AI 接口返回 HTTP 404",
    category: "API 地址或模型不可用",
    mustInclude: ["Base URL", "/v1", "HTTP 404"]
  },
  {
    name: "network classification",
    input: "AI 请求网络失败或超时",
    category: "网络连接或请求超时",
    mustInclude: ["网络", "重试"]
  },
  {
    name: "json classification",
    input: "AI 接口响应不是有效 JSON",
    category: "AI 响应格式不可解析",
    mustInclude: ["结构化 JSON", "有效 JSON"]
  },
  {
    name: "image channel classification",
    input: "AI 图像 Responses：AI 接口返回 HTTP 415 unsupported image media",
    category: "图像输入通道不支持",
    mustInclude: ["图片输入", "HTTP 415"]
  },
  {
    name: "redacted explanation",
    input: `AI failed at https://gateway.example.invalid/v1/responses with ${fakeBearer}`,
    category: "远端 AI 请求失败",
    mustInclude: ["[endpoint]", "Bearer [redacted]"],
    mustNotMatch: [/https?:\/\//i, /safety\.token/i]
  }
];

const explanationResults = explanationCases.map((testCase) => {
  const explanation = explainAiFailureReason(testCase.input);
  assert(explanation.category === testCase.category, `${testCase.name}: wrong category`);
  assert(explanation.message.includes(explanation.category), `${testCase.name}: message missing category`);
  assert(explanation.message.includes(explanation.detail), `${testCase.name}: message missing detail`);
  for (const fragment of testCase.mustInclude ?? []) {
    assert(explanation.message.includes(fragment), `${testCase.name}: missing ${fragment}`);
  }
  for (const pattern of testCase.mustNotMatch ?? []) {
    assert(!pattern.test(explanation.message), `${testCase.name}: leaked pattern ${pattern}`);
  }
  return {
    name: testCase.name,
    category: explanation.category,
    outputLength: explanation.message.length
  };
});

console.log(JSON.stringify({ status: "passed", cases: results, explanationCases: explanationResults }, null, 2));
