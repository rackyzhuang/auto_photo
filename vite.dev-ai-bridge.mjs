import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const CONFIG_FILE = "openAi.json";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.5";
const KNOWN_AI_PARAMS = new Set([
  "exposure",
  "temperature",
  "tint",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "saturation",
  "vibrance",
  "transparency",
  "clarity",
  "texture",
  "dehaze",
  "vignette",
  "grain",
  "sharpness",
  "noiseReduction",
  "qualityEnhancement",
  "skinProtection",
  "skinSmoothing",
  "skinTone",
  "teethWhitening",
  "clothingWrinkleReduction"
]);

const normalizeBaseUrl = (value) => {
  const trimmed = String(value || DEFAULT_BASE_URL).trim();
  return (trimmed || DEFAULT_BASE_URL).replace(/\/+$/, "");
};

const normalizeModel = (value) => {
  const trimmed = String(value || DEFAULT_MODEL).trim();
  if (!trimmed) return DEFAULT_MODEL;
  if (trimmed.toLowerCase() === "gpt5.5") return "gpt-5.5";
  return trimmed;
};

const jsonResponse = (res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
};

const readJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
};

const readLocalConfig = async (root) => {
  const configPath = path.join(root, CONFIG_FILE);
  let fileConfig = {};
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(await readFile(configPath, "utf8"));
    } catch {
      fileConfig = {};
    }
  }

  return {
    configPath,
    apiKey: String(
      process.env.OPENAI_API_KEY ||
        fileConfig.OPENAI_API_KEY ||
        fileConfig.apiKey ||
        fileConfig.api_key ||
        ""
    ).trim(),
    baseUrl: normalizeBaseUrl(
      process.env.OPENAI_BASE_URL ||
        process.env.API_URL ||
        fileConfig.OPENAI_BASE_URL ||
        fileConfig.API_URL ||
        fileConfig.baseUrl ||
        fileConfig.base_url ||
        DEFAULT_BASE_URL
    ),
    model: normalizeModel(process.env.OPENAI_MODEL || fileConfig.model || fileConfig.MODEL || DEFAULT_MODEL)
  };
};

const writeLocalConfig = async (root, settings) => {
  const current = await readLocalConfig(root);
  const apiKey = String(settings.apiKey || current.apiKey || "").trim();
  const baseUrl = normalizeBaseUrl(settings.baseUrl || current.baseUrl);
  const model = normalizeModel(settings.model || current.model);
  if (!apiKey) {
    throw new Error("请填写 API key，或在 openAi.json / OPENAI_API_KEY 中提供本地调试 key");
  }

  const nextConfig = {
    OPENAI_API_KEY: apiKey,
    API_URL: baseUrl,
    model
  };
  await writeFile(current.configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  return { ...current, apiKey, baseUrl, model };
};

const aiBaseCandidates = (baseUrl) => {
  const normalized = normalizeBaseUrl(baseUrl);
  const candidates = [normalized];
  const lastSegment = normalized.split("/").filter(Boolean).at(-1);
  if (!lastSegment || lastSegment.toLowerCase() !== "v1") {
    candidates.push(`${normalized}/v1`);
  }
  return [...new Set(candidates)];
};

const fetchJson = async (url, apiKey, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 45000);
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!response.ok) {
      const errorMessage =
        json?.error?.message || json?.message || text.slice(0, 220) || `HTTP ${response.status}`;
      throw new Error(`AI 服务返回 ${response.status}：${errorMessage}`);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
};

const fetchModels = async (config) => {
  if (!config.apiKey) throw new Error("AI key 尚未配置");
  const errors = [];
  for (const baseUrl of aiBaseCandidates(config.baseUrl)) {
    try {
      const json = await fetchJson(`${baseUrl}/models`, config.apiKey, { timeoutMs: 20000 });
      const models = Array.isArray(json.data)
        ? json.data.map((item) => String(item?.id || "").trim()).filter(Boolean)
        : [];
      models.sort();
      return {
        baseUrl,
        models: [...new Set(models)]
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(errors.at(-1) || "模型列表获取失败");
};

const buildSettingsState = (config, availableModels = []) => ({
  model: normalizeModel(config.model),
  baseUrl: normalizeBaseUrl(config.baseUrl),
  hasApiKey: Boolean(config.apiKey),
  availableModels
});

const extractResponseText = (json) => {
  if (typeof json.output_text === "string" && json.output_text.trim()) return json.output_text.trim();
  if (Array.isArray(json.output)) {
    const text = json.output
      .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
      .map((content) => content?.text || content?.output_text || "")
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  if (Array.isArray(json.choices)) {
    const text = json.choices
      .map((choice) => {
        const content = choice?.message?.content;
        if (typeof content === "string") return content;
        if (Array.isArray(content)) return content.map((item) => item?.text || "").join("\n");
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
};

const parseJsonObject = (text) => {
  const cleaned = String(text)
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("AI 没有返回可解析的 JSON 参数");
  }
};

const parseAiResult = (json, model, usedTextFallback) => {
  const text = extractResponseText(json);
  if (!text) throw new Error("AI 没有返回可读内容");
  const parsed = parseJsonObject(text);
  const params = parsed.params && typeof parsed.params === "object" ? parsed.params : {};
  const hasKnownField = Object.entries(params).some(([key, value]) => KNOWN_AI_PARAMS.has(key) && typeof value === "number");
  if (!hasKnownField) throw new Error("AI 返回 params 缺少可用调色字段");
  const summary = String(parsed.summary || "AI 已生成候选调色参数").trim().slice(0, 180);
  return {
    model,
    summary: usedTextFallback && !summary.includes("文本降级") ? `文本降级建议：${summary}` : summary,
    params
  };
};

const buildTunePrompt = (request) => {
  const modeLabel = request.mode === "styleMatch" ? "AI 追色" : "AI 调色";
  const styleInstruction =
    request.mode === "styleMatch"
      ? "参考图会作为第二张图片提供。结合用户原始指令决定要匹配参考图的哪些特征，不要机械复制与用户意图冲突的部分。"
      : "请观察当前照片，并把用户原始指令中的色彩、影调、氛围、年代感、材质感和主体关系准确映射为后期参数。";
  const userInstruction = String(request.userInstruction || "用户没有提供额外风格要求，请按照片内容做自然专业调色。")
    .trim()
    .slice(0, 1200);

  return `你是专业摄影后期调色助手，任务是${modeLabel}。${styleInstruction}
用户调色指令：${userInstruction}
用户指令是最高优先级的审美决策。必须逐项落实其中具体的颜色倾向、明暗关系、反差、饱和度、氛围、年代感和质感，不得收敛成“自然、风格、通透”等固定模板。
通透、层次可读和不过度放大噪点只是技术质量底线，不是固定审美目标；允许用户明确要求的冷峻、暗调、低饱和、复古、电影感、高反差、柔雾或其他个性方向。
summary 必须说清执行了用户指令中的哪些具体特征以及如何落实，不能只写泛化描述。
只返回一个 JSON 对象，不要 Markdown，不要代码块。JSON 格式必须是：{"summary":"一句中文说明","params":{"exposure":0,"temperature":0,"tint":0,"contrast":0,"highlights":0,"shadows":0,"whites":0,"blacks":0,"saturation":0,"vibrance":0,"transparency":0,"clarity":0,"texture":0,"dehaze":0,"vignette":0,"grain":0,"sharpness":0,"noiseReduction":0,"qualityEnhancement":0,"skinProtection":70}}。
参数范围：exposure -50 到 50；temperature/tint/contrast/saturation/vibrance/clarity/texture/dehaze/vignette -50 到 50；highlights -60 到 40；shadows -40 到 60；whites/blacks -40 到 40；grain 0 到 50；sharpness 0 到 40；transparency/noiseReduction/qualityEnhancement/skinProtection 0 到 100。
如果提高 clarity、texture、dehaze、transparency、sharpness 或 qualityEnhancement，必须同步给出适度 noiseReduction，避免噪点、色块和 JPEG 颗粒被放大。
可省略不需要修改的字段。不要猜测人物身份。文件名：${request.assetName}。相机信息：${request.cameraSummary}。当前参数：${JSON.stringify(request.currentParams)}。`;
};

const tunePhoto = async (config, request) => {
  if (!config.apiKey) throw new Error("AI key 尚未配置");
  const prompt = buildTunePrompt(request);
  const textOnlyPrompt = `${prompt}
图片输入通道在本次降级请求中不可用。请仅根据相机信息、当前参数和用户调色想法给出保守建议，并在 summary 中说明这是文本降级建议。只返回 JSON。`;
  const strictJsonPrompt = `Return exactly one JSON object for a personalized photo color-grading request. No markdown or code block. The user's concrete aesthetic instruction has highest priority; do not replace it with generic natural/clean/transparent styling. Preserve technical quality without neutralizing distinctive dark, muted, cinematic, vintage, high-contrast, soft, cool, warm, or other requested aesthetics. The summary must name the concrete requested traits and params must visibly implement them. Shape: {"summary":"具体说明如何落实用户审美","params":{"exposure":2,"temperature":3,"contrast":5,"vibrance":6,"skinProtection":80,"noiseReduction":12}}.
User instruction: ${request.userInstruction || ""}
Asset: ${request.assetName}
Camera summary: ${request.cameraSummary}
Current params: ${JSON.stringify(request.currentParams)}`;

  const responsesContent = [
    { type: "input_text", text: prompt },
    { type: "input_image", image_url: request.imageDataUrl, detail: "low" }
  ];
  const chatContent = [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: request.imageDataUrl, detail: "low" } }
  ];
  if (request.referenceDataUrl) {
    responsesContent.push({ type: "input_text", text: "下一张是参考风格图。" });
    responsesContent.push({ type: "input_image", image_url: request.referenceDataUrl, detail: "low" });
    chatContent.push({ type: "text", text: "下一张是参考风格图。" });
    chatContent.push({ type: "image_url", image_url: { url: request.referenceDataUrl, detail: "low" } });
  }

  const attempts = [];
  for (const baseUrl of aiBaseCandidates(config.baseUrl)) {
    attempts.push({
      url: `${baseUrl}/responses`,
      body: {
        model: config.model,
        input: [{ role: "user", content: responsesContent }],
        max_output_tokens: 520
      },
      textOnly: false
    });
    attempts.push({
      url: `${baseUrl}/chat/completions`,
      body: {
        model: config.model,
        messages: [{ role: "user", content: chatContent }],
        max_tokens: 520
      },
      textOnly: false
    });
    attempts.push({
      url: `${baseUrl}/responses`,
      body: {
        model: config.model,
        input: [{ role: "user", content: [{ type: "input_text", text: textOnlyPrompt }] }],
        max_output_tokens: 520
      },
      textOnly: true
    });
    attempts.push({
      url: `${baseUrl}/chat/completions`,
      body: {
        model: config.model,
        messages: [{ role: "user", content: textOnlyPrompt }],
        max_tokens: 520
      },
      textOnly: true
    });
    attempts.push({
      url: `${baseUrl}/chat/completions`,
      body: {
        model: config.model,
        messages: [{ role: "user", content: strictJsonPrompt }],
        max_tokens: 220,
        response_format: { type: "json_object" }
      },
      textOnly: true
    });
  }

  const errors = [];
  for (const attempt of attempts) {
    try {
      const json = await fetchJson(attempt.url, config.apiKey, {
        method: "POST",
        body: attempt.body,
        timeoutMs: 45000
      });
      return parseAiResult(json, config.model, attempt.textOnly);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(errors.at(-1) || "AI 调色请求失败");
};

export const autophotoDevAiBridge = (root = process.cwd()) => ({
  name: "autophoto-dev-ai-bridge",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/__autophoto_dev_ai", async (req, res, next) => {
      try {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const pathname = url.pathname.replace(/\/+$/, "") || "/";
        if (req.method === "GET" && pathname === "/settings") {
          const config = await readLocalConfig(root);
          jsonResponse(res, 200, buildSettingsState(config));
          return;
        }
        if (req.method === "POST" && pathname === "/settings") {
          const body = await readJsonBody(req);
          const config = await writeLocalConfig(root, body.settings || body);
          jsonResponse(res, 200, buildSettingsState(config, [config.model]));
          return;
        }
        if (req.method === "DELETE" && pathname === "/settings") {
          const config = await readLocalConfig(root);
          try {
            await unlink(config.configPath);
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
          jsonResponse(res, 200, buildSettingsState({
            apiKey: "",
            baseUrl: DEFAULT_BASE_URL,
            model: DEFAULT_MODEL
          }));
          return;
        }
        if (req.method === "POST" && pathname === "/diagnose") {
          const config = await readLocalConfig(root);
          try {
            const modelList = await fetchModels(config);
            const modelAvailable = modelList.models.length === 0 || modelList.models.includes(config.model);
            jsonResponse(res, 200, {
              status: config.apiKey && modelAvailable ? "passed" : "failed",
              hasApiKey: Boolean(config.apiKey),
              model: config.model,
              modelAvailable,
              modelCount: modelList.models.length,
              availableModels: modelList.models,
              message: modelList.models.length === 0
                ? "开发调试桥连接正常，模型列表为空，已保留当前手动模型用于调色请求"
                : modelAvailable
                ? `开发调试桥连接正常，当前模型可用，已获取 ${modelList.models.length} 个模型`
                : `开发调试桥已连接，但当前模型不在模型列表中，已获取 ${modelList.models.length} 个模型`
            });
          } catch (error) {
            jsonResponse(res, 200, {
              status: "failed",
              hasApiKey: Boolean(config.apiKey),
              model: config.model,
              modelAvailable: false,
              modelCount: 0,
              availableModels: [],
              message: `开发调试桥连接失败：${error instanceof Error ? error.message : String(error)}`
            });
          }
          return;
        }
        if (req.method === "POST" && pathname === "/tune") {
          const body = await readJsonBody(req);
          const config = await readLocalConfig(root);
          const result = await tunePhoto(config, body.request || body);
          jsonResponse(res, 200, result);
          return;
        }
        next();
      } catch (error) {
        jsonResponse(res, 500, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }
});
