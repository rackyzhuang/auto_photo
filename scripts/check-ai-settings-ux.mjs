import fs from "node:fs";
import path from "node:path";

const workspace = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(workspace, relativePath), "utf8");

const sources = {
  app: read(path.join("src", "App.tsx")),
  main: read(path.join("src", "main.tsx")),
  desktopBridge: read(path.join("src", "services", "desktopBridge.ts")),
  styles: read(path.join("src", "styles.css")),
  types: read(path.join("src", "types.ts")),
  rust: read(path.join("src-tauri", "src", "lib.rs")),
  aiSafety: read(path.join("src", "services", "aiSafety.ts")),
  aiConnectionDiagnostics: read(path.join("src", "diagnostics", "phase5AiConnectionDiagnostics.tsx")),
  aiLiveDiagnostics: read(path.join("src", "diagnostics", "phase5AiLiveDiagnostics.ts")),
  aiRawLiveDiagnostics: read(path.join("src", "diagnostics", "phase5AiRawLiveDiagnostics.ts")),
  uiDiagnostics: read(path.join("src", "diagnostics", "phase5UiDiagnostics.tsx")),
  aiRawDiagnostics: read(path.join("src", "diagnostics", "phase5AiRawDiagnostics.tsx")),
  desktopDiagnostics: read(path.join("src", "diagnostics", "phase5DesktopDiagnostics.ts")),
  readme: read("README.md"),
  readmeCn: read("README_CN.md")
};

const findings = [];
const requireIncludes = (sourceName, fragments) => {
  const source = sources[sourceName];
  for (const fragment of fragments) {
    if (!source.includes(fragment)) findings.push(`${sourceName}: missing ${fragment}`);
  }
};

requireIncludes("app", [
  "model: \"gpt-5.5\"",
  "baseUrl: \"https://api.openai.com/v1\"",
  "data-testid=\"ai-api-key-input\"",
  "type=\"password\"",
  "autoComplete=\"new-password\"",
  "placeholder={aiSettings.hasApiKey ? \"已保存，留空则保留\" : \"保存到系统钥匙串\"}",
  "data-testid=\"ai-base-url-input\"",
  "sanitizeAiBaseUrlForDisplay",
  "onBlur={() => setAiBaseUrlDraft((current) => sanitizeAiBaseUrlForDisplay(current))}",
  "data-testid=\"ai-save-settings-button\"",
  "data-testid=\"ai-diagnose-connection-button\"",
  "data-testid=\"ai-connection-diagnostic\"",
  "diagnoseAiConnection()",
  "__AUTO_PHOTO_INJECT_AI_CONNECTION_DIAGNOSTIC__",
  "AI 连接诊断仅在桌面端可用",
  "不会显示 API key 或私有地址",
  "modelAvailable",
  "modelCount",
  "保存 AI 设置并获取模型",
  "data-testid=\"ai-model-select\"",
  "data-testid=\"ai-edit-config-button\"",
  "修改 AI 配置",
  "getAiSettings()",
  "saveAiSettings({",
  "apiKey: aiApiKeyDraft.trim() ? aiApiKeyDraft : undefined",
  "explainAiFailureReason(error instanceof Error ? error.message : \"远端 AI 请求失败\")",
  "AI 设置仅在桌面端可保存",
  "请填写 API key，保存后会自动获取模型列表",
  "AI 只在用户点击时发送压缩预览图"
]);

requireIncludes("main", [
  "phase5-ai-connection",
  "phase5AiConnectionDiagnostics",
  "runPhase5AiConnectionDiagnostics",
  "phase5-ai-live",
  "phase5AiLiveDiagnostics",
  "runPhase5AiLiveDiagnostics",
  "phase5-ai-raw-live",
  "phase5AiRawLiveDiagnostics",
  "runPhase5AiRawLiveDiagnostics"
]);

requireIncludes("desktopBridge", [
  "export const getAiSettings",
  "invoke<AiSettingsState>(\"get_ai_settings\")",
  "export const saveAiSettings",
  "export const diagnoseAiConnection",
  "invoke<AiConnectionDiagnostic>(\"diagnose_ai_connection\")",
  "apiKey?: string",
  "model?: string",
  "baseUrl: string",
  "invoke<AiSettingsState>(\"save_ai_settings\""
]);

requireIncludes("types", [
  "export interface AiSettingsState",
  "model: string",
  "baseUrl: string",
  "hasApiKey: boolean",
  "availableModels: string[]",
  "export interface AiConnectionDiagnostic",
  "status: \"passed\" | \"failed\"",
  "modelAvailable: boolean",
  "modelCount: number"
]);

requireIncludes("rust", [
  "const DEFAULT_AI_MODEL: &str = \"gpt-5.5\"",
  "const DEFAULT_AI_BASE_URL: &str = \"https://api.openai.com/v1\"",
  "fn keyring_entry()",
  ".set_password(api_key)",
  "fn get_ai_settings",
  "fn save_ai_settings",
  "fn diagnose_ai_connection",
  "struct AiConnectionDiagnostic",
  "build_ai_connection_diagnostic",
  "model_count",
  "model_available",
  "AI 连接诊断通过",
  "settings.api_key",
  "normalize_ai_url",
  "normalize_ai_model",
  "available_ai_models_with_saved_fallback",
  "for candidate in ai_model_base_candidates(&base_url)",
  "let responses_endpoint = format!(\"{candidate}/responses\")",
  "let chat_endpoint = format!(\"{candidate}/chat/completions\")",
  "fn push_ai_attempt_error",
  "\"图像 Responses\"",
  "\"文本降级 Responses\"",
  "\"Strict JSON Responses\"",
  "summarize_ai_attempt_errors",
  "AI_KEYRING_USER",
  "ai_model_defaults_to_requested_gpt_55",
  "stored_ai_settings_reload_normalizes_model_and_base_url"
]);

requireIncludes("aiSafety", [
  "explainAiFailureReason",
  "API key 或权限异常",
  "API 地址或模型不可用",
  "图像输入通道不支持",
  "sanitizeAiFailureReason",
  "[endpoint]",
  "Bearer [redacted]",
  "[redacted-key]"
]);

requireIncludes("uiDiagnostics", [
  "__AUTO_PHOTO_INJECT_AI_CONNECTION_DIAGNOSTIC__",
  "assertAiConnectionDiagnosticLayout",
  "AI connection diagnostic injection",
  "AI connection passed result",
  "AI connection failed result",
  "aiConnectionDiagnostics"
]);

requireIncludes("aiConnectionDiagnostics", [
  "__AUTO_PHOTO_PHASE5_AI_CONNECTION_DIAGNOSTICS__",
  "__AUTO_PHOTO_INJECT_AI_SETTINGS__",
  "__AUTO_PHOTO_INJECT_AI_CONNECTION_DIAGNOSTIC__",
  "phase5AiConnectionStatus",
  "phase5-ai-connection-diagnostics",
  "assertDiagnosticResult",
  "must-not-show",
  "diagnostic-missing-model",
  "privacyPassed",
  "layoutPassed"
]);

requireIncludes("aiLiveDiagnostics", [
  "__AUTO_PHOTO_PHASE5_AI_LIVE_DIAGNOSTICS__",
  "diagnoseAiConnection",
  "saveDiagnosticReport(\"phase5-ai-live\", report)",
  "sanitizeDiagnosticText",
  "[redacted-url]",
  "Bearer [redacted]",
  "sk-[redacted]",
  "It does not read openAi.json",
  "Only sanitized connection status",
  "modelAvailable",
  "modelCount",
  "privacyPassed"
]);

requireIncludes("aiRawLiveDiagnostics", [
  "__AUTO_PHOTO_PHASE5_AI_RAW_LIVE_DIAGNOSTICS__",
  "readPhotoFiles([configuredSamplePath])",
  "readPhotoFiles([configuredReferencePath])",
  "desktopPhotoPayloadToFile",
  "importPhotoFile",
  "asset.previewKind !== \"raw_embedded\"",
  "tunePhotoWithAi({",
  "VITE_AUTO_PHOTO_RAW_AI_MODE",
  "mode: tuningMode",
  "imageDataUrl",
  "referenceDataUrl",
  "styleMatch",
  "saveDiagnosticReport(\"phase5-ai-raw-live\", report)",
  "data:image",
  "[redacted-image-data]",
  "It does not read openAi.json",
  "does not print or save API keys",
  "paramKeys",
  "paramsPreview",
  "privacyPassed"
]);

requireIncludes("aiRawDiagnostics", [
  "data-testid=\"ai-model-select\"",
  "Expected gpt-5.5",
  "AI key/base URL fields should be hidden after model list succeeds",
  "baseUrl: \"https://example.test/v1/models?api_key=must-not-show#secret\""
]);

requireIncludes("desktopDiagnostics", [
  "run isolated keyring smoke test",
  "aiKeyPresenceUnchanged",
  "It does not read, print, save or export any AI API key"
]);

requireIncludes("app", [
  "aiConnectionDiagnostic.message",
  "fallbackHint",
  "data-testid=\"ai-suggestion-fallback\"",
  "点击“诊断 AI 连接”",
  "图片输入通道和 JSON 参数返回",
  "已获取{\" \"}",
  "个模型"
]);

requireIncludes("styles", [
  ".ai-suggestion-card .ai-suggestion-fallback"
]);

requireIncludes("readme", [
  "AI settings can be saved, restored after restart",
  "safe, categorized reason with a suggested fix",
  "AI API keys are saved through the system keychain"
]);

requireIncludes("readmeCn", [
  "AI 设置可以保存，重启后仍可恢复",
  "安全、分类后的失败原因和处理建议",
  "AI API key 使用系统钥匙串保存"
]);

const app = sources.app;
const keyInputIndex = app.indexOf("data-testid=\"ai-api-key-input\"");
const saveButtonIndex = app.indexOf("data-testid=\"ai-save-settings-button\"");
const modelSelectIndex = app.indexOf("data-testid=\"ai-model-select\"");
if (keyInputIndex < 0 || saveButtonIndex < keyInputIndex) {
  findings.push("app: AI save button should follow API key/base URL inputs");
}
if (modelSelectIndex < 0 || modelSelectIndex > keyInputIndex) {
  findings.push("app: configured AI state should show model select before edit form");
}

const rust = sources.rust;
const saveSettingsIndex = rust.indexOf("fn save_ai_settings");
const setPasswordIndex = rust.indexOf(".set_password(api_key)", saveSettingsIndex);
const storedSettingsIndex = rust.indexOf("let normalized = AiStoredSettings", saveSettingsIndex);
const serializeIndex = rust.indexOf("serde_json::to_string_pretty(&normalized)", storedSettingsIndex);
const writeIndex = rust.indexOf("fs::write(ai_settings_path(&app)?, settings_json)", serializeIndex);
if (
  saveSettingsIndex < 0 ||
  setPasswordIndex < saveSettingsIndex ||
  storedSettingsIndex < setPasswordIndex ||
  serializeIndex < storedSettingsIndex ||
  writeIndex < serializeIndex
) {
  findings.push("rust: save_ai_settings should write API key to keyring before saving normalized non-secret settings");
}
const aiStoredSettingsBlock = rust.slice(rust.indexOf("struct AiStoredSettings"), rust.indexOf("struct AiSettingsState"));
if (aiStoredSettingsBlock.includes("api_key")) {
  findings.push("rust: AiStoredSettings must not contain api_key");
}

const summary = {
  status: findings.length > 0 ? "failed" : "passed",
  checks: 150,
  findings
};

console.log(JSON.stringify(summary, null, 2));
if (findings.length > 0) process.exitCode = 1;
