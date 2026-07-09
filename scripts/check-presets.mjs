import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const workspace = process.cwd();
const sourcePath = path.join(workspace, "src", "services", "editParams.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;

const { builtInPresets, normalizeEditParams } = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
);

const requiredSeries = [
  "\u4eba\u50cf",
  "\u98ce\u5149",
  "\u5efa\u7b51",
  "\u57ce\u5e02",
  "\u4e2a\u6027"
];

const requiredNamesBySeries = {
  "\u4eba\u50cf": ["\u81ea\u7136\u4eba\u50cf", "\u5976\u6cb9\u80a4\u8272", "\u5a5a\u793c\u6e05\u900f", "\u68da\u62cd\u5e72\u51c0", "\u4f4e\u9971\u548c\u80f6\u7247\u4eba\u50cf"],
  "\u98ce\u5149": ["\u84dd\u5929\u901a\u900f", "\u65e5\u843d\u6696\u8c03", "\u68ee\u6797\u7eff\u8c03", "\u96ea\u666f\u51b7\u51c0", "\u5c71\u91ce\u9ad8\u5bf9\u6bd4"],
  "\u5efa\u7b51": ["\u5ba4\u5185\u5efa\u7b51", "\u4e2d\u6027\u767d\u5899", "\u5546\u4e1a\u7a7a\u95f4", "\u51b7\u8c03\u5efa\u7b51", "\u6696\u5149\u9152\u5e97"],
  "\u57ce\u5e02": ["\u8857\u62cd\u7eaa\u5b9e", "\u591c\u666f\u9713\u8679", "\u96e8\u5929\u57ce\u5e02", "\u90fd\u5e02\u51b7\u8c03", "\u9ad8\u53cd\u5dee\u9ed1\u91d1"],
  "\u4e2a\u6027": ["\u7535\u5f71\u6697\u8c03", "\u65e5\u7cfb\u67d4\u548c", "\u590d\u53e4\u9897\u7c92", "\u9ad8\u9971\u548c\u8272\u5f69", "\u9ed1\u767d\u7eaa\u5b9e"]
};

const paramRanges = {
  exposure: [-50, 50],
  temperature: [-50, 50],
  tint: [-50, 50],
  contrast: [-50, 50],
  highlights: [-60, 40],
  shadows: [-40, 60],
  whites: [-40, 40],
  blacks: [-40, 40],
  saturation: [-50, 50],
  vibrance: [-50, 50],
  clarity: [-50, 50],
  texture: [-50, 50],
  dehaze: [-50, 50],
  vignette: [-50, 50],
  grain: [0, 50],
  sharpness: [0, 40],
  noiseReduction: [0, 40],
  skinProtection: [0, 100],
  skinSmoothing: [0, 100],
  skinTone: [-50, 50],
  teethWhitening: [0, 100],
  clothingWrinkleReduction: [0, 100]
};

const hslChannels = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"];
const hslRanges = {
  hue: [-50, 50],
  saturation: [-50, 50],
  luminance: [-50, 50]
};

const findings = [];
const fail = (message) => findings.push(message);
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const inRange = (value, [min, max]) => isFiniteNumber(value) && value >= min && value <= max;

if (!Array.isArray(builtInPresets)) {
  fail("builtInPresets must be an array");
}

const ids = new Set();
const bySeries = new Map(requiredSeries.map((series) => [series, []]));

for (const [index, preset] of builtInPresets.entries()) {
  const label = preset?.id ?? `preset#${index}`;
  if (!isNonEmptyString(preset?.id)) fail(`${label}: missing id`);
  if (ids.has(preset?.id)) fail(`${label}: duplicate id`);
  ids.add(preset?.id);

  if (!requiredSeries.includes(preset?.series)) fail(`${label}: unexpected series`);
  else bySeries.get(preset.series).push(preset);

  if (!isNonEmptyString(preset?.name)) fail(`${label}: missing name`);
  if (!isNonEmptyString(preset?.description)) fail(`${label}: missing description`);

  let normalized;
  try {
    normalized = normalizeEditParams(preset?.params);
  } catch (error) {
    fail(`${label}: normalizeEditParams failed (${error.message})`);
    continue;
  }

  for (const [key, range] of Object.entries(paramRanges)) {
    if (!inRange(normalized[key], range)) fail(`${label}: ${key} out of range`);
  }

  for (const channel of hslChannels) {
    const channelParams = normalized.hsl?.[channel];
    if (!channelParams) {
      fail(`${label}: missing hsl.${channel}`);
      continue;
    }
    for (const [key, range] of Object.entries(hslRanges)) {
      if (!inRange(channelParams[key], range)) fail(`${label}: hsl.${channel}.${key} out of range`);
    }
  }
}

for (const series of requiredSeries) {
  const presets = bySeries.get(series) ?? [];
  if (presets.length !== 5) fail(`${series}: expected 5 presets, got ${presets.length}`);
  const names = new Set(presets.map((preset) => preset.name));
  for (const name of requiredNamesBySeries[series]) {
    if (!names.has(name)) fail(`${series}: missing preset ${name}`);
  }
}

const summary = {
  status: findings.length > 0 ? "failed" : "passed",
  presetCount: builtInPresets.length,
  seriesCounts: Object.fromEntries([...bySeries.entries()].map(([series, presets]) => [series, presets.length])),
  findings
};

console.log(JSON.stringify(summary, null, 2));
if (findings.length > 0) process.exitCode = 1;
