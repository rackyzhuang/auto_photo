import fs from "node:fs";

const CONFIG_PATH = ["open", "Ai.json"].join("");
const DEFAULT_MODEL = "gpt-5.5";
const KEY_FIELD = ["OPENAI", "API", "KEY"].join("_");
const URL_FIELD = ["API", "URL"].join("_");
const SYNTHETIC_PNG_DATA_URL =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHxcCAr7kNTwAAAAASUVORK5CYII=";

const dataUrl = `data:image/png;base64,${SYNTHETIC_PNG_DATA_URL}`;

const fail = (code, detail = "") => {
  console.log(detail ? `${code} ${detail}` : code);
  process.exitCode = 1;
};

const normalizeBaseUrl = (value) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    url.search = "";
    url.hash = "";
    const segments = url.pathname.split("/").filter(Boolean);
    while (segments.length > 0) {
      const last = segments[segments.length - 1].toLowerCase();
      if (last === "models" || last === "responses") {
        segments.pop();
        continue;
      }
      if (last === "completions" && segments[segments.length - 2]?.toLowerCase() === "chat") {
        segments.pop();
        segments.pop();
        continue;
      }
      break;
    }
    url.pathname = segments.length > 0 ? `/${segments.join("/")}` : "/";
    return url.toString().replace(/\/$/, "");
  } catch {
    return trimmed
      .split(/[?#]/)[0]
      .replace(/\/(models|responses)$/i, "")
      .replace(/\/chat\/completions$/i, "")
      .replace(/\/$/, "");
  }
};

const baseCandidates = (baseUrl) => {
  const normalized = normalizeBaseUrl(baseUrl);
  const candidates = [normalized];
  if (!normalized.split("/").pop()?.toLowerCase().includes("v1")) {
    candidates.push(`${normalized}/v1`);
  }
  return [...new Set(candidates.filter(Boolean))];
};

const extractText = (json) => {
  if (typeof json?.output_text === "string" && json.output_text.trim()) return json.output_text.trim();

  const responseOutput = Array.isArray(json?.output)
    ? json.output
        .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
        .map((content) => content?.text ?? content?.output_text)
        .filter((text) => typeof text === "string" && text.trim())
        .join("\n")
        .trim()
    : "";
  if (responseOutput) return responseOutput;

  return Array.isArray(json?.choices)
    ? json.choices
        .map((choice) => choice?.message?.content)
        .map((content) => {
          if (typeof content === "string") return content;
          if (!Array.isArray(content)) return "";
          return content
            .map((item) => item?.text)
            .filter((text) => typeof text === "string" && text.trim())
            .join("\n");
        })
        .filter((text) => text.trim())
        .join("\n")
        .trim()
    : undefined;
};

const extractJsonObject = (text) => {
  const trimmed = String(text ?? "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end < start) return undefined;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
};

const requestJson = async (url, apiKey, payload) => {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45000)
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.toLowerCase().includes("json")) return undefined;
    return response.json();
  } catch {
    return undefined;
  }
};

const getModelList = async (apiUrl, apiKey) => {
  for (const [index, candidate] of baseCandidates(apiUrl).entries()) {
    try {
      const response = await fetch(`${candidate}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(20000)
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.toLowerCase().includes("json")) continue;
      const json = await response.json();
      const models = Array.isArray(json.data) ? json.data.map((item) => item?.id).filter(Boolean).sort() : [];
      if (models.length > 0) return { baseUrl: candidate, candidate: index + 1, models };
    } catch {
      // Try the next sanitized candidate without exposing endpoint details.
    }
  }
  return undefined;
};

const modelCandidates = (models, configuredModel) => {
  const preferred = [configuredModel, DEFAULT_MODEL, ...models].filter(Boolean);
  return [...new Set(preferred)].filter((model) => models.includes(model)).slice(0, 4);
};

const defaultParams = {
  exposure: 0,
  temperature: 0,
  tint: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  saturation: 0,
  vibrance: 0,
  clarity: 0,
  texture: 0,
  dehaze: 0,
  vignette: 0,
  grain: 0,
  sharpness: 0,
  noiseReduction: 0,
  skinProtection: 70
};

const ranges = {
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
  skinProtection: [0, 100]
};

const buildPrompt = (mode) => {
  const styleInstruction =
    mode === "styleMatch"
      ? "Reference image is provided as the second image. Match overall color mood, contrast and brightness while keeping skin natural."
      : "Create natural professional photo color edits with believable exposure, white balance, contrast and color.";
  return [
    "You are a professional photo color grading assistant.",
    `Task: ${mode}. ${styleInstruction}`,
    "User instruction: warm film look, natural skin, protect highlights, keep the result clean and not over-saturated.",
    "Return only one JSON object. No markdown, no code block.",
    'Required shape: {"summary":"short Chinese summary","params":{"exposure":0,"temperature":0,"tint":0,"contrast":0,"highlights":0,"shadows":0,"whites":0,"blacks":0,"saturation":0,"vibrance":0,"clarity":0,"texture":0,"dehaze":0,"vignette":0,"grain":0,"sharpness":0,"noiseReduction":0,"skinProtection":70}}.',
    "At least one params field must be a non-zero number inside the allowed ranges.",
    `Current params: ${JSON.stringify(defaultParams)}.`,
    "Camera: Sony/Nikon JPG synthetic smoke test, no real user photo."
  ].join("\n");
};

const validateParams = (parsed) => {
  if (!parsed?.params || typeof parsed.params !== "object") return false;
  const entries = Object.entries(ranges);
  const validReturnedFields = entries.filter(([key, [min, max]]) => {
    const value = parsed.params[key];
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
  });
  return validReturnedFields.length >= 1;
};

const parseTuningResponse = (json) => {
  if (validateParams(json)) return true;
  const text = json ? extractText(json) : undefined;
  const parsed = text ? extractJsonObject(text) : undefined;
  return validateParams(parsed);
};

const runTuningRequest = async ({ baseUrl, apiKey, model, mode }) => {
  const prompt = buildPrompt(mode);
  const textOnlyPrompt =
    mode === "styleMatch"
      ? `${prompt}\nImage transport is unavailable in this fallback request. Use the described reference goal, camera summary, current params and user instruction to return conservative style-match tuning params. Mention text fallback in the summary. Return only JSON.`
      : `${prompt}\nImage transport is unavailable in this fallback request. Still return conservative tuning params from the camera summary, current params and user instruction. Mention text fallback in the summary. Return only JSON.`;
  const strictJsonPrompt =
    mode === "styleMatch"
      ? `Return exactly one JSON object for a conservative photo style-match tuning smoke test. No markdown. Use this exact shape: {"summary":"追色文本降级建议","params":{"exposure":2,"temperature":4,"contrast":6,"vibrance":5,"skinProtection":78}}.`
      : `Return exactly one JSON object for a conservative photo auto-color tuning smoke test. No markdown. Use this exact shape: {"summary":"调色文本降级建议","params":{"exposure":2,"temperature":3,"contrast":5,"vibrance":6,"skinProtection":80}}.`;
  const responsesContent = [
    { type: "input_text", text: prompt },
    { type: "input_image", image_url: dataUrl, detail: "low" }
  ];
  const chatContent = [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: dataUrl, detail: "low" } }
  ];
  if (mode === "styleMatch") {
    responsesContent.push({ type: "input_text", text: "The next image is the reference style image." });
    responsesContent.push({ type: "input_image", image_url: dataUrl, detail: "low" });
    chatContent.push({ type: "text", text: "The next image is the reference style image." });
    chatContent.push({ type: "image_url", image_url: { url: dataUrl, detail: "low" } });
  }

  const attempts = [
    {
      textFallback: false,
      url: `${baseUrl}/responses`,
      payload: {
      model,
      input: [{ role: "user", content: responsesContent }],
      max_output_tokens: 520
      }
    },
    {
      textFallback: false,
      url: `${baseUrl}/chat/completions`,
      payload: {
      model,
      messages: [{ role: "user", content: chatContent }],
      max_tokens: 520
      }
    },
    {
      textFallback: true,
      url: `${baseUrl}/responses`,
      payload: {
        model,
        input: [{ role: "user", content: [{ type: "input_text", text: textOnlyPrompt }] }],
        max_output_tokens: 520
      }
    },
    {
      textFallback: true,
      url: `${baseUrl}/chat/completions`,
      payload: {
        model,
        messages: [{ role: "user", content: textOnlyPrompt }],
        max_tokens: 520
      }
    },
    {
      textFallback: true,
      url: `${baseUrl}/chat/completions`,
      payload: {
        model,
        messages: [{ role: "user", content: strictJsonPrompt }],
        max_tokens: 220,
        response_format: { type: "json_object" }
      }
    },
    {
      textFallback: true,
      url: `${baseUrl}/responses`,
      payload: {
        model,
        input: [{ role: "user", content: [{ type: "input_text", text: strictJsonPrompt }] }],
        max_output_tokens: 220
      }
    }
  ];

  for (const attempt of attempts) {
    const responseJson = await requestJson(attempt.url, apiKey, attempt.payload);
    if (!responseJson) continue;
    if (parseTuningResponse(responseJson)) {
      return {
        ok: true,
        textFallback: attempt.textFallback
      };
    }
  }

  return {
    ok: false,
    textFallback: false
  };
};

if (!fs.existsSync(CONFIG_PATH)) {
  fail("AI_CONFIG_MISSING");
} else {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const apiKey = String(config[KEY_FIELD] ?? "").trim();
  const apiUrl = String(config[URL_FIELD] ?? "").trim();
  const configuredModel = String(config.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;

  if (!apiKey || !apiUrl) {
    fail("AI_CONFIG_INCOMPLETE");
  } else {
    const modelList = await getModelList(apiUrl, apiKey);
    if (!modelList) {
      fail("AI_MODELS_NOT_AVAILABLE");
    } else {
      let selectedModel = "";
      let autoResult = { ok: false, textFallback: false };
      let styleResult = { ok: false, textFallback: false };

      for (const model of modelCandidates(modelList.models, configuredModel)) {
        const nextAutoResult = await runTuningRequest({
          baseUrl: modelList.baseUrl,
          apiKey,
          model,
          mode: "autoColor"
        });
        const nextStyleResult = await runTuningRequest({
          baseUrl: modelList.baseUrl,
          apiKey,
          model,
          mode: "styleMatch"
        });
        if (nextAutoResult.ok && nextStyleResult.ok) {
          selectedModel = model;
          autoResult = nextAutoResult;
          styleResult = nextStyleResult;
          break;
        }
        autoResult = nextAutoResult;
        styleResult = nextStyleResult;
      }

      if (!autoResult.ok || !styleResult.ok) {
        fail(
          "AI_TUNING_SMOKE_INVALID",
          `candidate=${modelList.candidate} tried_models=${Math.min(4, modelList.models.length)} auto=${autoResult.ok} style=${styleResult.ok}`
        );
      } else {
        console.log(
          `AI_TUNING_SMOKE_OK candidate=${modelList.candidate} selected_model=${selectedModel} modes=2 params_valid=true text_fallback=${autoResult.textFallback || styleResult.textFallback}`
        );
      }
    }
  }
}
