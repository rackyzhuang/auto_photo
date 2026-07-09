import fs from "node:fs";

const CONFIG_PATH = ["open", "Ai.json"].join("");
const DEFAULT_MODEL = "gpt-5.5";
const KEY_FIELD = ["OPENAI", "API", "KEY"].join("_");
const URL_FIELD = ["API", "URL"].join("_");

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

  const chatOutput = Array.isArray(json?.choices)
    ? json.choices
        .map((choice) => choice?.message?.content)
        .map((content) => {
          if (typeof content === "string") return content;
          if (Array.isArray(content)) {
            return content
              .map((item) => item?.text)
              .filter((text) => typeof text === "string" && text.trim())
              .join("\n");
          }
          return "";
        })
        .filter((text) => text.trim())
        .join("\n")
        .trim()
    : "";
  return chatOutput || undefined;
};

const extractJsonObject = (text) => {
  const trimmed = text.trim();
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
    if (!response.ok || !contentType.toLowerCase().includes("json")) {
      return undefined;
    }
    return response.json();
  } catch {
    return undefined;
  }
};

const responseHasParams = (json) => {
  if (json?.params && typeof json.params === "object") return true;
  const text = json ? extractText(json) : undefined;
  const parsed = text ? extractJsonObject(text) : undefined;
  return Boolean(parsed?.params && typeof parsed.params === "object");
};

const modelCandidates = (models, configuredModel) => {
  const preferred = [configuredModel, DEFAULT_MODEL, ...models].filter(Boolean);
  return [...new Set(preferred)].filter((model) => models.includes(model)).slice(0, 4);
};

const runSmoke = async (baseUrl, apiKey, model) => {
  const prompt =
    'Return only JSON: {"summary":"ok","params":{"exposure":1,"temperature":0,"skinProtection":70}}';
  const strictPrompt =
    'Return exactly one JSON object. No markdown. Use this exact shape: {"summary":"ok","params":{"exposure":1,"temperature":0,"skinProtection":70}}';

  const attempts = [
    {
      url: `${baseUrl}/responses`,
      payload: {
        model,
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
        max_output_tokens: 120
      }
    },
    {
      url: `${baseUrl}/chat/completions`,
      payload: {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 120
      }
    },
    {
      url: `${baseUrl}/chat/completions`,
      payload: {
        model,
        messages: [{ role: "user", content: strictPrompt }],
        max_tokens: 120,
        response_format: { type: "json_object" }
      }
    },
    {
      url: `${baseUrl}/responses`,
      payload: {
        model,
        input: [{ role: "user", content: [{ type: "input_text", text: strictPrompt }] }],
        max_output_tokens: 120
      }
    }
  ];

  for (const attempt of attempts) {
    const json = await requestJson(attempt.url, apiKey, attempt.payload);
    if (responseHasParams(json)) return true;
  }

  return false;
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
    let selectedBase;
    let selectedCandidate = 0;
    let models = [];

    for (const [index, candidate] of baseCandidates(apiUrl).entries()) {
      try {
        const response = await fetch(`${candidate}/models`, {
          headers: { authorization: `Bearer ${apiKey}` }
        });
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !contentType.toLowerCase().includes("json")) continue;
        const json = await response.json();
        models = Array.isArray(json.data) ? json.data.map((item) => item?.id).filter(Boolean).sort() : [];
        if (models.length > 0) {
          selectedBase = candidate;
          selectedCandidate = index + 1;
          break;
        }
      } catch {
        // Try the next sanitized candidate without exposing endpoint details.
      }
    }

    if (!selectedBase) {
      fail("AI_MODELS_NOT_AVAILABLE");
    } else {
      let selectedModel = "";
      for (const model of modelCandidates(models, configuredModel)) {
        if (await runSmoke(selectedBase, apiKey, model)) {
          selectedModel = model;
          break;
        }
      }

      if (!selectedModel) {
        fail(
          "AI_SMOKE_RESPONSE_INVALID",
          `candidate=${selectedCandidate} models=${models.length} tried_models=${Math.min(4, models.length)}`
        );
      } else {
        console.log(
          `AI_CONFIG_OK candidate=${selectedCandidate} models=${models.length} has_gpt_5_5=${models.includes(
            DEFAULT_MODEL
          )} selected_model=${selectedModel} smoke_json=true`
        );
      }
    }
  }
}
