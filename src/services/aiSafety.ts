const AI_FAILURE_FALLBACK = "远端 AI 请求失败";

export const sanitizeAiFailureReason = (value: string) => {
  const sanitized = value
    .replace(/https?:\/\/[^\s，。；,;]+/gi, "[endpoint]")
    .replace(/sk-[A-Za-z0-9]{12,}/g, "[redacted-key]")
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return sanitized || AI_FAILURE_FALLBACK;
};

export interface AiFailureExplanation {
  category: string;
  action: string;
  detail: string;
  message: string;
}

const httpStatusFromText = (text: string) => {
  const match = text.match(/HTTP\s+(\d{3})/i);
  return match ? Number(match[1]) : undefined;
};

export const explainAiFailureReason = (value: string): AiFailureExplanation => {
  const detail = sanitizeAiFailureReason(value);
  const lower = detail.toLowerCase();
  const status = httpStatusFromText(detail);

  let category = "远端 AI 请求失败";
  let action = "可以稍后重试；当前已安全回退到本地色彩科学候选";

  if (status === 401 || status === 403 || /unauthorized|forbidden|permission|api key|auth/.test(lower)) {
    category = "API key 或权限异常";
    action = "请检查 API key 是否有效，并确认当前模型有调用权限";
  } else if (status === 404 || /not found|model.*not|模型.*不存在|model.*unavailable/.test(lower)) {
    category = "API 地址或模型不可用";
    action = "请检查 Base URL、/v1 路径和模型名称是否匹配当前网关";
  } else if (status === 408 || /timeout|timed out|网络失败|network/.test(lower)) {
    category = "网络连接或请求超时";
    action = "请检查网络、代理或网关连通性后重试";
  } else if (status === 429 || /rate limit|quota|insufficient quota|too many requests/.test(lower)) {
    category = "额度或频率限制";
    action = "请稍后重试，或检查账号额度和网关限流设置";
  } else if (status && status >= 500) {
    category = "AI 网关服务异常";
    action = "请稍后重试，或切换到可用的兼容网关";
  } else if (/image|input_image|vision|unsupported.*media|图像|图片/.test(lower) && (status === 400 || status === 415 || /unsupported|不支持/.test(lower))) {
    category = "图像输入通道不支持";
    action = "请确认当前模型和网关支持图片输入；否则会使用文本降级或本地候选";
  } else if (/json|params|可读参数|无法解析|不是有效/.test(lower)) {
    category = "AI 响应格式不可解析";
    action = "请确认模型会返回结构化 JSON 参数，或切换更稳定的模型";
  } else if (status === 400) {
    category = "请求参数或模型不兼容";
    action = "请检查模型是否支持当前请求格式和图片输入";
  }

  return {
    category,
    action,
    detail,
    message: `${category}：${action}。详情：${detail}`
  };
};
