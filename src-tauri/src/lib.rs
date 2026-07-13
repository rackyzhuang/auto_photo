use base64::{engine::general_purpose, Engine as _};
use exif::{In, Reader, Tag, Value};
use keyring::Entry;
use rusqlite::{params, Connection};
use std::io::BufReader;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::Manager;

const AI_KEYRING_SERVICE: &str = "auto-photo";
const AI_KEYRING_USER: &str = "openai-api-key";
const DEFAULT_AI_MODEL: &str = "gpt-5.5";
const DEFAULT_AI_BASE_URL: &str = "https://api.openai.com/v1";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedExport {
    path: String,
    skipped: bool,
    file_name: String,
}

#[derive(serde::Serialize)]
struct ProjectStoreInfo {
    path: String,
}

#[derive(serde::Serialize)]
struct ProjectStoreSummary {
    path: String,
    asset_count: i64,
    jpg_count: i64,
    raw_count: i64,
    editable_count: i64,
    metadata_count: i64,
    edit_count: i64,
    preset_count: i64,
    export_job_count: i64,
    named_project_count: i64,
    snapshot_updated_at: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PhotoFilePayload {
    name: String,
    path: String,
    size: u64,
    mime_type: String,
    data_base64: String,
    metadata: Option<PhotoFileMetadata>,
}

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct PhotoFileMetadata {
    make: Option<String>,
    model: Option<String>,
    lens: Option<String>,
    iso: Option<u32>,
    exposure_time: Option<String>,
    f_number: Option<f64>,
    focal_length: Option<f64>,
    date_time_original: Option<String>,
    orientation: Option<u32>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportJobHistory {
    job_id: String,
    created_at: String,
    mode: String,
    status: String,
    total_count: i64,
    completed_count: i64,
    failed_count: i64,
    output_dir: Option<String>,
    items: Option<serde_json::Value>,
    failed: Option<serde_json::Value>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NamedProjectInfo {
    project_id: String,
    name: String,
    asset_count: i64,
    jpg_count: i64,
    raw_count: i64,
    updated_at: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiTuningRequest {
    mode: String,
    asset_name: String,
    camera_summary: String,
    image_data_url: String,
    reference_data_url: Option<String>,
    user_instruction: Option<String>,
    current_params: serde_json::Value,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AiTuningResult {
    model: String,
    summary: String,
    params: serde_json::Value,
}

#[derive(Default)]
struct AiRuntimeConfig {
    api_key: String,
    model: String,
    base_url: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiSettingsInput {
    api_key: Option<String>,
    model: Option<String>,
    base_url: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiStoredSettings {
    model: String,
    base_url: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AiSettingsState {
    model: String,
    base_url: String,
    has_api_key: bool,
    available_models: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AiConnectionDiagnostic {
    status: String,
    has_api_key: bool,
    model: String,
    model_available: bool,
    model_count: usize,
    message: String,
}

struct AiModelList {
    base_url: String,
    models: Vec<String>,
}

fn sanitize_file_name(file_name: &str) -> String {
    let mut sanitized = file_name
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();

    if sanitized.is_empty() {
        sanitized = "auto-photo-export.jpg".to_string();
    }

    if !sanitized.to_lowercase().ends_with(".jpg") && !sanitized.to_lowercase().ends_with(".jpeg") {
        sanitized.push_str(".jpg");
    }

    sanitized
}

fn default_ai_settings() -> AiStoredSettings {
    AiStoredSettings {
        model: DEFAULT_AI_MODEL.to_string(),
        base_url: DEFAULT_AI_BASE_URL.to_string(),
    }
}

fn ai_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    fs::create_dir_all(&app_data_dir).map_err(|error| format!("无法创建应用数据目录：{error}"))?;
    Ok(app_data_dir.join("ai-settings.json"))
}

fn normalize_ai_url(base_url: &str) -> String {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return DEFAULT_AI_BASE_URL.to_string();
    }

    let candidate = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    if let Ok(mut url) = reqwest::Url::parse(&candidate) {
        url.set_query(None);
        url.set_fragment(None);

        let mut segments = url
            .path()
            .split('/')
            .filter(|segment| !segment.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();

        loop {
            let last = segments.last().map(|segment| segment.to_ascii_lowercase());
            match last.as_deref() {
                Some("responses") | Some("models") => {
                    segments.pop();
                }
                Some("completions")
                    if segments
                        .iter()
                        .rev()
                        .nth(1)
                        .is_some_and(|segment| segment.eq_ignore_ascii_case("chat")) =>
                {
                    segments.pop();
                    segments.pop();
                }
                _ => break,
            }
        }

        let normalized_path = if segments.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", segments.join("/"))
        };
        url.set_path(&normalized_path);
        return url.as_str().trim_end_matches('/').to_string();
    }

    trimmed
        .split(['?', '#'])
        .next()
        .unwrap_or(DEFAULT_AI_BASE_URL)
        .trim_end_matches('/')
        .to_string()
}

fn normalize_ai_model(model: Option<&str>) -> String {
    let trimmed = model.unwrap_or(DEFAULT_AI_MODEL).trim();
    if trimmed.is_empty() {
        return DEFAULT_AI_MODEL.to_string();
    }
    if trimmed.eq_ignore_ascii_case("gpt5.5") {
        return DEFAULT_AI_MODEL.to_string();
    }
    trimmed.chars().take(100).collect()
}

fn normalize_ai_stored_settings(settings: AiStoredSettings) -> AiStoredSettings {
    AiStoredSettings {
        model: normalize_ai_model(Some(&settings.model)),
        base_url: normalize_ai_url(&settings.base_url),
    }
}

fn load_stored_ai_settings_from_path(path: &Path) -> AiStoredSettings {
    let Ok(text) = fs::read_to_string(path) else {
        return default_ai_settings();
    };
    let Ok(settings) = serde_json::from_str::<AiStoredSettings>(&text) else {
        return default_ai_settings();
    };
    normalize_ai_stored_settings(settings)
}

fn load_stored_ai_settings(app: &tauri::AppHandle) -> AiStoredSettings {
    let Ok(path) = ai_settings_path(app) else {
        return default_ai_settings();
    };
    load_stored_ai_settings_from_path(&path)
}

fn keyring_entry() -> Result<Entry, String> {
    Entry::new(AI_KEYRING_SERVICE, AI_KEYRING_USER)
        .map_err(|error| format!("系统钥匙串不可用，无法保存或读取 API key：{error}"))
}

fn has_ai_api_key() -> bool {
    keyring_entry()
        .and_then(|entry| entry.get_password().map_err(|_| "missing".to_string()))
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn load_ai_api_key() -> Result<String, String> {
    let api_key = keyring_entry().and_then(|entry| {
        entry
            .get_password()
            .map_err(|error| format!("请先在 AI 设置中保存 API key；钥匙串读取失败：{error}"))
    })?;
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("请先在 AI 设置中保存 API key".to_string());
    }
    Ok(api_key)
}

fn load_ai_runtime_config(app: &tauri::AppHandle) -> Result<AiRuntimeConfig, String> {
    let settings = load_stored_ai_settings(app);
    let api_key = load_ai_api_key()?;

    Ok(AiRuntimeConfig {
        api_key,
        model: settings.model,
        base_url: settings.base_url,
    })
}

fn create_ai_client(timeout_secs: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|_| "AI 客户端初始化失败".to_string())
}

fn parse_ai_models_response(response_json: serde_json::Value) -> Vec<String> {
    let mut models = response_json
        .get("data")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(|value| value.as_str()))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    models.sort();
    models.dedup();
    models
}

fn ai_model_base_candidates(base_url: &str) -> Vec<String> {
    let normalized = normalize_ai_url(base_url);
    let mut candidates = vec![normalized.clone()];
    if !normalized
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .is_some_and(|segment| segment.eq_ignore_ascii_case("v1"))
    {
        candidates.push(format!("{}/v1", normalized.trim_end_matches('/')));
    }
    candidates.sort();
    candidates.dedup();
    candidates
}

fn fetch_ai_models(base_url: &str, api_key: &str) -> Result<AiModelList, String> {
    let client = create_ai_client(20)?;
    let mut saw_non_json_success = false;

    for candidate in ai_model_base_candidates(base_url) {
        let endpoint = format!("{}/models", candidate.trim_end_matches('/'));
        let response = match client.get(endpoint).bearer_auth(api_key).send() {
            Ok(response) => response,
            Err(_) => continue,
        };

        if !response.status().is_success() {
            continue;
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !content_type.contains("json") {
            saw_non_json_success = true;
            continue;
        }

        let response_json: serde_json::Value = response
            .json()
            .map_err(|_| "AI 模型列表响应格式无效".to_string())?;
        let models = parse_ai_models_response(response_json);
        if !models.is_empty() {
            return Ok(AiModelList {
                base_url: candidate,
                models,
            });
        }
    }

    if saw_non_json_success {
        Err("AI 模型列表响应不是 JSON，已尝试自动补 /v1；请确认 Base URL 指向 OpenAI-compatible API 根路径".to_string())
    } else {
        Err("AI 模型列表请求失败，请检查 API key、Base URL 和网络连接".to_string())
    }
}

fn build_ai_settings_state(
    settings: AiStoredSettings,
    has_api_key: bool,
    available_models: Vec<String>,
) -> AiSettingsState {
    AiSettingsState {
        model: settings.model,
        base_url: settings.base_url,
        has_api_key,
        available_models,
    }
}

fn available_ai_models_with_saved_fallback(
    settings: &AiStoredSettings,
    model_list: Result<AiModelList, String>,
) -> Vec<String> {
    match model_list {
        Ok(model_list) if !model_list.models.is_empty() => model_list.models,
        _ => vec![settings.model.clone()],
    }
}

fn build_ai_connection_diagnostic(
    settings: AiStoredSettings,
    has_api_key: bool,
    model_list: Result<AiModelList, String>,
) -> AiConnectionDiagnostic {
    if !has_api_key {
        return AiConnectionDiagnostic {
            status: "failed".to_string(),
            has_api_key: false,
            model: settings.model,
            model_available: false,
            model_count: 0,
            message: "AI key 尚未保存；请先保存 API key 后再诊断连接。".to_string(),
        };
    }

    match model_list {
        Ok(model_list) => {
            let model_count = model_list.models.len();
            let model_available = model_count == 0
                || model_list
                    .models
                    .iter()
                    .any(|model| model == &settings.model);
            let message = if model_count == 0 {
                "AI 连接诊断通过：模型列表为空，已保留当前手动模型用于调色请求。".to_string()
            } else if model_available {
                format!("AI 连接诊断通过：已获取 {model_count} 个模型，当前模型可用。")
            } else {
                format!(
                    "AI 连接诊断通过：已获取 {model_count} 个模型，但当前模型不在模型列表中，请切换可用模型。"
                )
            };
            AiConnectionDiagnostic {
                status: if model_available { "passed" } else { "failed" }.to_string(),
                has_api_key: true,
                model: settings.model,
                model_available,
                model_count,
                message,
            }
        }
        Err(error) => AiConnectionDiagnostic {
            status: "failed".to_string(),
            has_api_key: true,
            model: settings.model,
            model_available: false,
            model_count: 0,
            message: format!(
                "AI 连接诊断未通过：{}。请检查 API key、Base URL、/v1 路径、模型权限或网络。",
                error.chars().take(120).collect::<String>()
            ),
        },
    }
}

#[tauri::command]
fn get_ai_settings(app: tauri::AppHandle) -> Result<AiSettingsState, String> {
    let settings = load_stored_ai_settings(&app);
    let has_api_key = has_ai_api_key();
    let available_models = if has_api_key {
        let model_list =
            load_ai_api_key().and_then(|api_key| fetch_ai_models(&settings.base_url, &api_key));
        available_ai_models_with_saved_fallback(&settings, model_list)
    } else {
        Vec::new()
    };
    Ok(build_ai_settings_state(
        settings,
        has_api_key,
        available_models,
    ))
}

#[tauri::command]
fn save_ai_settings(
    app: tauri::AppHandle,
    settings: AiSettingsInput,
) -> Result<AiSettingsState, String> {
    if let Some(api_key) = settings.api_key {
        let api_key = api_key.trim();
        if !api_key.is_empty() {
            keyring_entry()?
                .set_password(api_key)
                .map_err(|error| format!("API key 写入系统钥匙串失败：{error}"))?;
        }
    }

    let base_url = normalize_ai_url(&settings.base_url);
    let api_key = load_ai_api_key()?;
    let model_list = fetch_ai_models(&base_url, &api_key)?;
    let base_url = model_list.base_url;
    let available_models = model_list.models;
    let requested_model = normalize_ai_model(settings.model.as_deref());
    let selected_model = if available_models
        .iter()
        .any(|model| model == &requested_model)
    {
        requested_model
    } else if available_models
        .iter()
        .any(|model| model == DEFAULT_AI_MODEL)
    {
        DEFAULT_AI_MODEL.to_string()
    } else {
        available_models
            .first()
            .cloned()
            .unwrap_or_else(|| DEFAULT_AI_MODEL.to_string())
    };
    let normalized = AiStoredSettings {
        model: selected_model,
        base_url,
    };
    let settings_json = serde_json::to_string_pretty(&normalized)
        .map_err(|error| format!("无法序列化 AI 设置：{error}"))?;
    fs::write(ai_settings_path(&app)?, settings_json)
        .map_err(|error| format!("无法保存 AI 设置：{error}"))?;

    Ok(build_ai_settings_state(normalized, true, available_models))
}

#[tauri::command]
fn diagnose_ai_connection(app: tauri::AppHandle) -> Result<AiConnectionDiagnostic, String> {
    let settings = load_stored_ai_settings(&app);
    let has_api_key = has_ai_api_key();
    let model_list = if has_api_key {
        load_ai_api_key().and_then(|api_key| fetch_ai_models(&settings.base_url, &api_key))
    } else {
        Err("AI key 尚未保存".to_string())
    };
    Ok(build_ai_connection_diagnostic(
        settings,
        has_api_key,
        model_list,
    ))
}

fn extract_response_text(response_json: &serde_json::Value) -> Option<String> {
    if let Some(text) = response_json
        .get("output_text")
        .and_then(|value| value.as_str())
    {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    response_json
        .get("output")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .flat_map(|item| {
                    item.get("content")
                        .and_then(|value| value.as_array())
                        .cloned()
                        .unwrap_or_default()
                })
                .filter_map(|content| {
                    content
                        .get("text")
                        .and_then(|value| value.as_str())
                        .or_else(|| content.get("output_text").and_then(|value| value.as_str()))
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned)
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|text| !text.trim().is_empty())
        .or_else(|| {
            response_json
                .get("choices")
                .and_then(|value| value.as_array())
                .map(|choices| {
                    choices
                        .iter()
                        .filter_map(|choice| {
                            choice
                                .get("message")
                                .and_then(|message| message.get("content"))
                                .and_then(|content| {
                                    content.as_str().map(ToOwned::to_owned).or_else(|| {
                                        content.as_array().map(|items| {
                                            items
                                                .iter()
                                                .filter_map(|item| {
                                                    item.get("text")
                                                        .and_then(|value| value.as_str())
                                                })
                                                .collect::<Vec<_>>()
                                                .join("\n")
                                        })
                                    })
                                })
                        })
                        .map(|text| text.trim().to_string())
                        .filter(|text| !text.is_empty())
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .filter(|text| !text.trim().is_empty())
        })
}

#[tauri::command]
fn save_export_file(
    output_dir: String,
    file_name: String,
    data_url: String,
    conflict_strategy: String,
) -> Result<SavedExport, String> {
    let output_dir = PathBuf::from(output_dir);
    if !output_dir.is_dir() {
        return Err("导出目录不存在".to_string());
    }

    let (_, payload) = data_url
        .split_once(',')
        .ok_or_else(|| "导出图片数据格式无效".to_string())?;
    let bytes = general_purpose::STANDARD
        .decode(payload)
        .map_err(|_| "导出图片 Base64 解码失败".to_string())?;

    let safe_name = sanitize_file_name(&file_name);
    let output_path = resolve_export_path(&output_dir, &safe_name, &conflict_strategy)?;
    if output_path.exists() && conflict_strategy == "skip" {
        return Ok(SavedExport {
            path: output_path.to_string_lossy().to_string(),
            skipped: true,
            file_name: safe_name,
        });
    }

    let output_file_name = output_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&safe_name)
        .to_string();
    fs::write(&output_path, bytes).map_err(|error| format!("写入导出文件失败：{error}"))?;

    Ok(SavedExport {
        path: output_path.to_string_lossy().to_string(),
        skipped: false,
        file_name: output_file_name,
    })
}

fn resolve_export_path(
    output_dir: &PathBuf,
    safe_name: &str,
    conflict_strategy: &str,
) -> Result<PathBuf, String> {
    let output_path = output_dir.join(safe_name);
    if conflict_strategy == "overwrite" || conflict_strategy == "skip" || !output_path.exists() {
        return Ok(output_path);
    }

    let source_path = PathBuf::from(safe_name);
    let stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("auto-photo-export");
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("jpg");

    for index in 1..10_000 {
        let candidate = output_dir.join(format!("{stem} ({index}).{extension}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("无法生成不重名的导出文件名".to_string())
}

fn extract_json_object(text: &str) -> Result<serde_json::Value, String> {
    let trimmed = text.trim();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Ok(value);
    }

    let start = trimmed
        .find('{')
        .ok_or_else(|| "AI 没有返回 JSON 参数".to_string())?;
    let end = trimmed
        .rfind('}')
        .ok_or_else(|| "AI 返回 JSON 不完整".to_string())?;
    serde_json::from_str::<serde_json::Value>(&trimmed[start..=end])
        .map_err(|_| "AI 返回 JSON 无法解析".to_string())
}

fn post_ai_json(
    client: &reqwest::blocking::Client,
    endpoint: &str,
    api_key: &str,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(payload)
        .send()
        .map_err(|_| "AI 请求网络失败或超时".to_string())?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("AI 接口返回 HTTP {}", status.as_u16()));
    }

    response
        .json::<serde_json::Value>()
        .map_err(|_| "AI 接口响应不是有效 JSON".to_string())
}

fn format_ai_attempt_error(label: &str, error: &str) -> String {
    format!("AI {label}：{error}")
}

fn push_ai_attempt_error(errors: &mut Vec<String>, label: &str, error: String) {
    let formatted = format_ai_attempt_error(label, &error);
    if !errors.iter().any(|existing| existing == &formatted) {
        errors.push(formatted);
    }
}

fn summarize_ai_attempt_errors(errors: &[String], fallback: &str) -> String {
    if errors.is_empty() {
        return fallback.to_string();
    }

    let mut selected = errors.iter().take(3).cloned().collect::<Vec<_>>();
    if let Some(last) = errors.last() {
        if !selected.iter().any(|item| item == last) {
            selected.push(last.clone());
        }
    }

    selected.join("；").chars().take(300).collect()
}

fn ai_params_have_known_numeric_field(params: &serde_json::Value) -> bool {
    let Some(object) = params.as_object() else {
        return false;
    };
    [
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
        "clothingWrinkleReduction",
    ]
    .iter()
    .any(|key| object.get(*key).and_then(|value| value.as_f64()).is_some())
}

fn parse_ai_tuning_result(
    response_json: &serde_json::Value,
    used_text_only_fallback: bool,
) -> Result<(String, serde_json::Value), String> {
    let output_text =
        extract_response_text(response_json).ok_or_else(|| "AI 没有返回可读参数".to_string())?;
    let suggestion = extract_json_object(&output_text)?;
    let params = suggestion
        .get("params")
        .cloned()
        .ok_or_else(|| "AI 返回结果缺少 params".to_string())?;
    if !params.is_object() {
        return Err("AI 返回 params 不是对象".to_string());
    }
    if !ai_params_have_known_numeric_field(&params) {
        return Err("AI 返回 params 缺少可用调色字段".to_string());
    }
    let mut summary = suggestion
        .get("summary")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("AI 已生成候选调色参数")
        .chars()
        .take(180)
        .collect::<String>();
    if used_text_only_fallback && !summary.contains("文本降级") {
        summary = format!("文本降级建议：{summary}")
            .chars()
            .take(180)
            .collect();
    }
    Ok((summary, params))
}

#[tauri::command]
fn tune_photo_with_openai(
    app: tauri::AppHandle,
    request: AiTuningRequest,
) -> Result<AiTuningResult, String> {
    let config = load_ai_runtime_config(&app)?;
    let base_url = normalize_ai_url(&config.base_url);
    let mode_label = if request.mode == "styleMatch" {
        "AI 追色"
    } else {
        "AI 调色"
    };
    let style_instruction = if request.mode == "styleMatch" {
        "参考图会作为第二张图片提供。请让当前图接近参考图的整体色彩、对比、明度和氛围，但保护肤色与自然观感。"
    } else {
        "请根据当前照片自动给出自然、可信、不过度的后期参数，优先修正曝光、白平衡、对比和色彩自然度。"
    };
    let user_instruction = request
        .user_instruction
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(500).collect::<String>())
        .unwrap_or_else(|| "用户没有提供额外风格要求，请按照片内容做自然专业调色。".to_string());
    let prompt = format!(
    "你是专业摄影后期调色助手，任务是{}。{}\
    用户调色想法：{}\
    只返回一个 JSON 对象，不要 Markdown，不要代码块。JSON 格式必须是：\
    {{\"summary\":\"一句中文说明\",\"params\":{{\"exposure\":0,\"temperature\":0,\"tint\":0,\"contrast\":0,\"highlights\":0,\"shadows\":0,\"whites\":0,\"blacks\":0,\"saturation\":0,\"vibrance\":0,\"transparency\":0,\"clarity\":0,\"texture\":0,\"dehaze\":0,\"vignette\":0,\"grain\":0,\"sharpness\":0,\"noiseReduction\":0,\"qualityEnhancement\":0,\"skinProtection\":70}}}}。\
    参数范围：exposure -50 到 50；temperature/tint/contrast/saturation/vibrance/clarity/texture/dehaze/vignette -50 到 50；\
    highlights -60 到 40；shadows -40 到 60；whites/blacks -40 到 40；grain 0 到 50；sharpness 0 到 40；transparency/noiseReduction/qualityEnhancement/skinProtection 0 到 100。\
    如果提高 clarity、texture、dehaze、transparency、sharpness 或 qualityEnhancement，必须同步给出适度 noiseReduction，避免噪点、色块和 JPEG 颗粒被放大。\
    可省略不需要修改的字段。不要猜测人物身份。文件名：{}。相机信息：{}。当前参数：{}。",
    mode_label,
    style_instruction,
    user_instruction,
    request.asset_name,
    request.camera_summary,
    request.current_params
  );
    let text_only_prompt = if request.mode == "styleMatch" {
        format!(
            "{prompt}\n图片输入通道在本次降级请求中不可用。请根据相机信息、参考风格统计、当前参数和用户调色想法给出保守追色建议，并在 summary 中说明这是文本降级建议。只返回 JSON。"
        )
    } else {
        format!(
            "{prompt}\n图片输入通道在本次降级请求中不可用。请仅根据相机信息、当前参数和用户调色想法给出保守建议，并在 summary 中说明这是文本降级建议。只返回 JSON。"
        )
    };
    let strict_json_prompt = if request.mode == "styleMatch" {
        format!(
            "Return exactly one JSON object for a conservative photo style-match tuning request. No markdown, no code block. Use the user instruction, camera summary, current params, and saved reference style summary below. The result must contain at least one non-zero numeric edit field. Shape: {{\"summary\":\"追色文本降级建议\",\"params\":{{\"exposure\":2,\"temperature\":4,\"contrast\":6,\"vibrance\":5,\"skinProtection\":78}}}}.\nUser instruction: {}\nAsset: {}\nCamera summary: {}\nCurrent params: {}",
            user_instruction, request.asset_name, request.camera_summary, request.current_params
        )
    } else {
        format!(
            "Return exactly one JSON object for a conservative photo auto-color tuning request. No markdown, no code block. Use the user instruction, camera summary, and current params below. The result must contain at least one non-zero numeric edit field. Shape: {{\"summary\":\"调色文本降级建议\",\"params\":{{\"exposure\":2,\"temperature\":3,\"contrast\":5,\"vibrance\":6,\"skinProtection\":80}}}}.\nUser instruction: {}\nAsset: {}\nCamera summary: {}\nCurrent params: {}",
            user_instruction, request.asset_name, request.camera_summary, request.current_params
        )
    };
    let mut responses_content = vec![
        serde_json::json!({ "type": "input_text", "text": prompt }),
        serde_json::json!({ "type": "input_image", "image_url": request.image_data_url, "detail": "low" }),
    ];
    let mut chat_content = vec![
        serde_json::json!({ "type": "text", "text": prompt }),
        serde_json::json!({ "type": "image_url", "image_url": { "url": request.image_data_url, "detail": "low" } }),
    ];
    if let Some(reference_data_url) = request.reference_data_url {
        responses_content
            .push(serde_json::json!({ "type": "input_text", "text": "下一张是参考风格图。" }));
        responses_content
            .push(serde_json::json!({ "type": "input_image", "image_url": reference_data_url, "detail": "low" }));
        chat_content.push(serde_json::json!({ "type": "text", "text": "下一张是参考风格图。" }));
        chat_content.push(
            serde_json::json!({ "type": "image_url", "image_url": { "url": reference_data_url, "detail": "low" } }),
        );
    }
    let responses_payload = serde_json::json!({
      "model": config.model.clone(),
      "input": [
        {
          "role": "user",
          "content": responses_content
        }
      ],
      "max_output_tokens": 520
    });
    let chat_payload = serde_json::json!({
      "model": config.model.clone(),
      "messages": [
        {
          "role": "user",
          "content": chat_content
        }
      ],
      "max_tokens": 520
    });
    let text_only_responses_payload = serde_json::json!({
      "model": config.model.clone(),
      "input": [
        {
          "role": "user",
          "content": [
            { "type": "input_text", "text": text_only_prompt }
          ]
        }
      ],
      "max_output_tokens": 520
    });
    let text_only_chat_payload = serde_json::json!({
      "model": config.model.clone(),
      "messages": [
        {
          "role": "user",
          "content": text_only_prompt
        }
      ],
      "max_tokens": 520
    });
    let strict_json_chat_payload = serde_json::json!({
      "model": config.model.clone(),
      "messages": [
        {
          "role": "user",
          "content": strict_json_prompt
        }
      ],
      "max_tokens": 220,
      "response_format": { "type": "json_object" }
    });
    let strict_json_responses_payload = serde_json::json!({
      "model": config.model.clone(),
      "input": [
        {
          "role": "user",
          "content": [
            { "type": "input_text", "text": strict_json_prompt }
          ]
        }
      ],
      "max_output_tokens": 220
    });

    let client = create_ai_client(45)?;
    let mut attempts: Vec<(&'static str, String, &serde_json::Value, bool)> = Vec::new();
    for candidate in ai_model_base_candidates(&base_url) {
        let candidate = candidate.trim_end_matches('/');
        let responses_endpoint = format!("{candidate}/responses");
        let chat_endpoint = format!("{candidate}/chat/completions");
        attempts.extend([
            (
                "图像 Responses",
                responses_endpoint.clone(),
                &responses_payload,
                false,
            ),
            (
                "图像 Chat Completions",
                chat_endpoint.clone(),
                &chat_payload,
                false,
            ),
            (
                "文本降级 Responses",
                responses_endpoint.clone(),
                &text_only_responses_payload,
                true,
            ),
            (
                "文本降级 Chat Completions",
                chat_endpoint.clone(),
                &text_only_chat_payload,
                true,
            ),
            (
                "Strict JSON Chat Completions",
                chat_endpoint,
                &strict_json_chat_payload,
                true,
            ),
            (
                "Strict JSON Responses",
                responses_endpoint,
                &strict_json_responses_payload,
                true,
            ),
        ]);
    }
    let mut attempt_errors: Vec<String> = Vec::new();
    let mut request_attempted = false;

    for (label, endpoint, payload, used_text_only_fallback) in attempts {
        match post_ai_json(&client, &endpoint, &config.api_key, payload) {
            Ok(response_json) => {
                request_attempted = true;
                match parse_ai_tuning_result(&response_json, used_text_only_fallback) {
                    Ok((summary, params)) => {
                        return Ok(AiTuningResult {
                            model: config.model.clone(),
                            summary,
                            params,
                        });
                    }
                    Err(error) => {
                        push_ai_attempt_error(&mut attempt_errors, label, error);
                    }
                }
            }
            Err(error) => {
                push_ai_attempt_error(&mut attempt_errors, label, error);
            }
        }
    }

    if request_attempted {
        Err(summarize_ai_attempt_errors(
            &attempt_errors,
            "AI 没有返回可用调色参数",
        ))
    } else {
        Err(summarize_ai_attempt_errors(
            &attempt_errors,
            "AI 请求失败，核心调色功能不受影响",
        ))
    }
}

fn project_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    fs::create_dir_all(&app_data_dir).map_err(|error| format!("无法创建应用数据目录：{error}"))?;
    Ok(app_data_dir.join("auto-photo.sqlite"))
}

fn open_project_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let db_path = project_db_path(app)?;
    let connection =
        Connection::open(db_path).map_err(|error| format!("无法打开项目数据库：{error}"))?;
    connection
        .execute_batch(
            "
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS project_snapshots (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        snapshot_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        file_hash TEXT,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        type TEXT NOT NULL,
        source_format TEXT NOT NULL DEFAULT 'jpg',
        is_editable INTEGER NOT NULL DEFAULT 1,
        camera_brand TEXT NOT NULL,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS asset_metadata (
        asset_id TEXT PRIMARY KEY,
        metadata_json TEXT NOT NULL,
        FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS edits (
        asset_id TEXT PRIMARY KEY,
        edit_json TEXT NOT NULL,
        auto_summary_json TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        params_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS export_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        settings_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS named_projects (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        asset_count INTEGER NOT NULL,
        jpg_count INTEGER NOT NULL,
        raw_count INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      ",
        )
        .map_err(|error| format!("无法初始化项目数据库：{error}"))?;
    ensure_assets_schema(&connection)?;
    ensure_export_jobs_schema(&connection)?;
    Ok(connection)
}

fn table_columns(connection: &Connection, table_name: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table_name})"))
        .map_err(|error| format!("无法检查 {table_name} 表：{error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("无法读取 {table_name} 表结构：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法读取 {table_name} 表字段：{error}"))?;
    Ok(columns)
}

fn ensure_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    definition: &str,
) -> Result<(), String> {
    let columns = table_columns(connection, table_name)?;
    if columns.iter().any(|column| column == column_name) {
        return Ok(());
    }

    connection
        .execute(
            &format!("ALTER TABLE {table_name} ADD COLUMN {definition}"),
            [],
        )
        .map_err(|error| format!("无法迁移 {table_name}.{column_name}：{error}"))?;
    Ok(())
}

fn ensure_assets_schema(connection: &Connection) -> Result<(), String> {
    ensure_column(connection, "assets", "file_hash", "file_hash TEXT")?;
    ensure_column(
        connection,
        "assets",
        "source_format",
        "source_format TEXT NOT NULL DEFAULT 'jpg'",
    )?;
    ensure_column(
        connection,
        "assets",
        "is_editable",
        "is_editable INTEGER NOT NULL DEFAULT 1",
    )?;
    Ok(())
}

fn ensure_export_jobs_schema(connection: &Connection) -> Result<(), String> {
    let columns = table_columns(connection, "export_jobs")?;

    if !columns.is_empty() && !columns.iter().any(|column| column == "job_id") {
        connection
            .execute("DROP TABLE export_jobs", [])
            .map_err(|error| format!("无法迁移旧导出任务表：{error}"))?;
    }

    connection
        .execute_batch(
            "
      CREATE TABLE IF NOT EXISTS export_jobs (
        job_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        total_count INTEGER NOT NULL,
        completed_count INTEGER NOT NULL,
        failed_count INTEGER NOT NULL,
        output_dir TEXT,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      ",
        )
        .map_err(|error| format!("无法创建导出任务表：{error}"))?;
    Ok(())
}

fn asset_key(asset: &serde_json::Value) -> String {
    if let Some(file_hash) = asset.get("fileHash").and_then(|value| value.as_str()) {
        if !file_hash.is_empty() {
            return file_hash.to_string();
        }
    }
    let name = asset
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown");
    let size = asset
        .get("size")
        .and_then(|value| value.as_i64())
        .unwrap_or(0);
    format!("{name}:{size}")
}

fn count_rows(connection: &Connection, table_name: &str) -> Result<i64, String> {
    connection
        .query_row(&format!("SELECT COUNT(*) FROM {table_name}"), [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("无法统计 {table_name}：{error}"))
}

fn count_rows_where(
    connection: &Connection,
    table_name: &str,
    where_clause: &str,
) -> Result<i64, String> {
    connection
        .query_row(
            &format!("SELECT COUNT(*) FROM {table_name} WHERE {where_clause}"),
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("无法统计 {table_name}：{error}"))
}

fn snapshot_asset_counts(snapshot: &serde_json::Value) -> (i64, i64, i64) {
    let Some(assets) = snapshot.get("assets").and_then(|value| value.as_array()) else {
        return (0, 0, 0);
    };
    let asset_count = assets.len() as i64;
    let jpg_count = assets
        .iter()
        .filter(|asset| {
            asset
                .get("sourceFormat")
                .and_then(|value| value.as_str())
                .unwrap_or("jpg")
                == "jpg"
        })
        .count() as i64;
    let raw_count = assets
        .iter()
        .filter(|asset| {
            asset
                .get("sourceFormat")
                .and_then(|value| value.as_str())
                .unwrap_or("jpg")
                == "raw"
        })
        .count() as i64;
    (asset_count, jpg_count, raw_count)
}

fn normalize_project_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return "未命名项目".to_string();
    }
    trimmed.chars().take(80).collect()
}

fn store_normalized_snapshot(
    connection: &mut Connection,
    snapshot: &serde_json::Value,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始项目库事务：{error}"))?;

    transaction
        .execute("DELETE FROM asset_metadata", [])
        .map_err(|error| format!("无法清理元数据表：{error}"))?;
    transaction
        .execute("DELETE FROM edits", [])
        .map_err(|error| format!("无法清理编辑表：{error}"))?;
    transaction
        .execute("DELETE FROM assets", [])
        .map_err(|error| format!("无法清理资产表：{error}"))?;
    transaction
        .execute("DELETE FROM presets", [])
        .map_err(|error| format!("无法清理预设表：{error}"))?;

    if let Some(assets) = snapshot.get("assets").and_then(|value| value.as_array()) {
        for asset in assets {
            let asset_id = asset_key(asset);
            let file_hash = asset.get("fileHash").and_then(|value| value.as_str());
            let name = asset
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            let size = asset
                .get("size")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);
            let file_type = asset
                .get("type")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let source_format = asset
                .get("sourceFormat")
                .and_then(|value| value.as_str())
                .unwrap_or("jpg");
            let is_editable = asset
                .get("isEditable")
                .and_then(|value| value.as_bool())
                .unwrap_or(true);
            let is_editable_value = if is_editable { 1_i64 } else { 0_i64 };
            let camera_brand = asset
                .get("cameraBrand")
                .and_then(|value| value.as_str())
                .unwrap_or("Unknown");
            let metadata_json =
                serde_json::to_string(asset.get("metadata").unwrap_or(&serde_json::Value::Null))
                    .map_err(|error| format!("无法序列化资产元数据：{error}"))?;
            let edit_json =
                serde_json::to_string(asset.get("edits").unwrap_or(&serde_json::Value::Null))
                    .map_err(|error| format!("无法序列化编辑参数：{error}"))?;
            let auto_summary_json =
                serde_json::to_string(asset.get("autoSummary").unwrap_or(&serde_json::Value::Null))
                    .map_err(|error| format!("无法序列化自动摘要：{error}"))?;

            transaction
        .execute(
          "
          INSERT INTO assets (id, file_hash, name, size, type, source_format, is_editable, camera_brand)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
          ",
          params![asset_id, file_hash, name, size, file_type, source_format, is_editable_value, camera_brand],
        )
        .map_err(|error| format!("无法写入资产表：{error}"))?;
            transaction
                .execute(
                    "INSERT INTO asset_metadata (asset_id, metadata_json) VALUES (?1, ?2)",
                    params![asset_id, metadata_json],
                )
                .map_err(|error| format!("无法写入元数据表：{error}"))?;
            transaction
        .execute(
          "INSERT INTO edits (asset_id, edit_json, auto_summary_json) VALUES (?1, ?2, ?3)",
          params![asset_id, edit_json, auto_summary_json],
        )
        .map_err(|error| format!("无法写入编辑表：{error}"))?;
        }
    }

    if let Some(presets) = snapshot
        .get("customPresets")
        .and_then(|value| value.as_array())
    {
        for preset in presets {
            let preset_id = preset
                .get("id")
                .and_then(|value| value.as_str())
                .unwrap_or("preset");
            let name = preset
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("未命名预设");
            let description = preset
                .get("description")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let params_json =
                serde_json::to_string(preset.get("params").unwrap_or(&serde_json::Value::Null))
                    .map_err(|error| format!("无法序列化预设参数：{error}"))?;
            transaction
                .execute(
                    "
          INSERT INTO presets (id, name, description, params_json)
          VALUES (?1, ?2, ?3, ?4)
          ",
                    params![preset_id, name, description, params_json],
                )
                .map_err(|error| format!("无法写入预设表：{error}"))?;
        }
    }

    let settings_json = serde_json::to_string(
        snapshot
            .get("exportSettings")
            .unwrap_or(&serde_json::Value::Null),
    )
    .map_err(|error| format!("无法序列化导出设置：{error}"))?;
    transaction
        .execute(
            "
      INSERT INTO export_settings (id, settings_json, updated_at)
      VALUES (1, ?1, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        settings_json = excluded.settings_json,
        updated_at = CURRENT_TIMESTAMP
      ",
            params![settings_json],
        )
        .map_err(|error| format!("无法写入导出任务表：{error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("无法提交项目库事务：{error}"))?;
    Ok(())
}

#[tauri::command]
fn save_project_snapshot(
    app: tauri::AppHandle,
    snapshot: serde_json::Value,
) -> Result<ProjectStoreInfo, String> {
    let snapshot_json =
        serde_json::to_string(&snapshot).map_err(|error| format!("无法序列化项目快照：{error}"))?;
    let mut connection = open_project_db(&app)?;
    connection
        .execute(
            "
      INSERT INTO project_snapshots (id, snapshot_json, updated_at)
      VALUES (1, ?1, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        snapshot_json = excluded.snapshot_json,
        updated_at = CURRENT_TIMESTAMP;
      ",
            params![snapshot_json],
        )
        .map_err(|error| format!("无法保存项目快照：{error}"))?;
    store_normalized_snapshot(&mut connection, &snapshot)?;

    Ok(ProjectStoreInfo {
        path: project_db_path(&app)?.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn save_named_project_snapshot(
    app: tauri::AppHandle,
    name: String,
    snapshot: serde_json::Value,
) -> Result<NamedProjectInfo, String> {
    let snapshot_json =
        serde_json::to_string(&snapshot).map_err(|error| format!("无法序列化命名项目：{error}"))?;
    let mut connection = open_project_db(&app)?;
    let project_name = normalize_project_name(&name);
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("无法生成项目 ID：{error}"))?
        .as_millis();
    let project_id = format!("project-{now_ms}");
    let (asset_count, jpg_count, raw_count) = snapshot_asset_counts(&snapshot);

    connection
    .execute(
      "
      INSERT INTO named_projects (project_id, name, snapshot_json, asset_count, jpg_count, raw_count, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP)
      ",
      params![project_id, project_name, snapshot_json, asset_count, jpg_count, raw_count],
    )
    .map_err(|error| format!("无法保存命名项目：{error}"))?;

    connection
        .execute(
            "
      INSERT INTO project_snapshots (id, snapshot_json, updated_at)
      VALUES (1, ?1, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        snapshot_json = excluded.snapshot_json,
        updated_at = CURRENT_TIMESTAMP
      ",
            params![serde_json::to_string(&snapshot)
                .map_err(|error| format!("无法序列化 latest 项目：{error}"))?],
        )
        .map_err(|error| format!("无法同步 latest 项目快照：{error}"))?;
    store_normalized_snapshot(&mut connection, &snapshot)?;

    Ok(NamedProjectInfo {
        project_id,
        name: project_name,
        asset_count,
        jpg_count,
        raw_count,
        updated_at: "刚刚".to_string(),
    })
}

#[tauri::command]
fn list_named_project_snapshots(app: tauri::AppHandle) -> Result<Vec<NamedProjectInfo>, String> {
    let connection = open_project_db(&app)?;
    let mut statement = connection
        .prepare(
            "
      SELECT project_id, name, asset_count, jpg_count, raw_count, updated_at
      FROM named_projects
      ORDER BY updated_at DESC
      LIMIT 30
      ",
        )
        .map_err(|error| format!("无法读取项目列表：{error}"))?;

    let projects = statement
        .query_map([], |row| {
            Ok(NamedProjectInfo {
                project_id: row.get(0)?,
                name: row.get(1)?,
                asset_count: row.get(2)?,
                jpg_count: row.get(3)?,
                raw_count: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|error| format!("无法查询项目列表：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法解析项目列表：{error}"))?;
    Ok(projects)
}

#[tauri::command]
fn load_named_project_snapshot(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let mut connection = open_project_db(&app)?;
    let snapshot_json = connection
        .query_row(
            "SELECT snapshot_json FROM named_projects WHERE project_id = ?1",
            params![project_id],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let Some(snapshot_json) = snapshot_json else {
        return Ok(None);
    };
    let snapshot: serde_json::Value = serde_json::from_str(&snapshot_json)
        .map_err(|error| format!("命名项目 JSON 无效：{error}"))?;
    connection
        .execute(
            "
      INSERT INTO project_snapshots (id, snapshot_json, updated_at)
      VALUES (1, ?1, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        snapshot_json = excluded.snapshot_json,
        updated_at = CURRENT_TIMESTAMP
      ",
            params![snapshot_json],
        )
        .map_err(|error| format!("无法同步 latest 项目快照：{error}"))?;
    store_normalized_snapshot(&mut connection, &snapshot)?;
    Ok(Some(snapshot))
}

#[tauri::command]
fn load_project_snapshot(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let connection = open_project_db(&app)?;
    let mut statement = connection
        .prepare("SELECT snapshot_json FROM project_snapshots WHERE id = 1")
        .map_err(|error| format!("无法读取项目快照：{error}"))?;
    let mut rows = statement
        .query([])
        .map_err(|error| format!("无法查询项目快照：{error}"))?;

    if let Some(row) = rows
        .next()
        .map_err(|error| format!("无法读取项目快照行：{error}"))?
    {
        let snapshot_json: String = row
            .get(0)
            .map_err(|error| format!("无法读取项目快照内容：{error}"))?;
        let snapshot = serde_json::from_str(&snapshot_json)
            .map_err(|error| format!("项目快照 JSON 无效：{error}"))?;
        return Ok(Some(snapshot));
    }

    Ok(None)
}

#[tauri::command]
fn get_project_store_info(app: tauri::AppHandle) -> Result<ProjectStoreInfo, String> {
    Ok(ProjectStoreInfo {
        path: project_db_path(&app)?.to_string_lossy().to_string(),
    })
}

fn photo_mime(extension: &str) -> Option<&'static str> {
    match extension {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "arw" => Some("image/x-sony-arw"),
        "nef" => Some("image/x-nikon-nef"),
        _ => None,
    }
}

fn find_exif_field<'a>(exif: &'a exif::Exif, tag: Tag) -> Option<&'a exif::Field> {
    exif.get_field(tag, In::PRIMARY)
        .or_else(|| exif.fields().find(|field| field.tag == tag))
}

fn exif_ascii(exif: &exif::Exif, tag: Tag) -> Option<String> {
    let field = find_exif_field(exif, tag)?;
    if let Value::Ascii(values) = &field.value {
        let value = values.first()?;
        let text = String::from_utf8_lossy(value).trim().to_string();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    } else {
        let text = field
            .display_value()
            .to_string()
            .trim()
            .trim_matches('"')
            .to_string();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }
}

fn exif_uint(exif: &exif::Exif, tag: Tag) -> Option<u32> {
    find_exif_field(exif, tag)?.value.get_uint(0)
}

fn exif_rational_number(exif: &exif::Exif, tag: Tag) -> Option<f64> {
    let field = find_exif_field(exif, tag)?;
    match &field.value {
        Value::Rational(values) => {
            let value = values.first()?;
            if value.denom == 0 {
                None
            } else {
                Some(value.num as f64 / value.denom as f64)
            }
        }
        Value::SRational(values) => {
            let value = values.first()?;
            if value.denom == 0 {
                None
            } else {
                Some(value.num as f64 / value.denom as f64)
            }
        }
        _ => None,
    }
}

fn exif_display(exif: &exif::Exif, tag: Tag) -> Option<String> {
    let field = find_exif_field(exif, tag)?;
    let text = field.display_value().with_unit(exif).to_string();
    let text = text.trim().trim_matches('"').to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn read_photo_metadata(path: &Path) -> Option<PhotoFileMetadata> {
    let file = fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let exif = Reader::new().read_from_container(&mut reader).ok()?;
    let metadata = PhotoFileMetadata {
        make: exif_ascii(&exif, Tag::Make),
        model: exif_ascii(&exif, Tag::Model),
        lens: exif_ascii(&exif, Tag::LensModel),
        iso: exif_uint(&exif, Tag::PhotographicSensitivity)
            .or_else(|| exif_uint(&exif, Tag::ISOSpeed)),
        exposure_time: exif_display(&exif, Tag::ExposureTime),
        f_number: exif_rational_number(&exif, Tag::FNumber),
        focal_length: exif_rational_number(&exif, Tag::FocalLength),
        date_time_original: exif_ascii(&exif, Tag::DateTimeOriginal),
        orientation: exif_uint(&exif, Tag::Orientation),
    };

    if metadata.make.is_some()
        || metadata.model.is_some()
        || metadata.lens.is_some()
        || metadata.iso.is_some()
        || metadata.exposure_time.is_some()
        || metadata.f_number.is_some()
        || metadata.focal_length.is_some()
        || metadata.date_time_original.is_some()
        || metadata.orientation.is_some()
    {
        Some(metadata)
    } else {
        None
    }
}

#[tauri::command]
fn read_photo_files(file_paths: Vec<String>) -> Result<Vec<PhotoFilePayload>, String> {
    const MAX_IMPORT_FILES: usize = 24;
    const MAX_IMPORT_FILE_BYTES: u64 = 128 * 1024 * 1024;
    const MAX_IMPORT_TOTAL_BYTES: u64 = 384 * 1024 * 1024;

    if file_paths.len() > MAX_IMPORT_FILES {
        return Err(format!(
            "一次最多选择 {MAX_IMPORT_FILES} 个文件，请分批导入"
        ));
    }

    let mut total_bytes = 0_u64;
    let mut files = Vec::new();

    for file_path in file_paths {
        let path = PathBuf::from(&file_path);
        if !path.exists() {
            return Err(format!("文件不存在：{}", path.to_string_lossy()));
        }
        if !path.is_file() {
            return Err(format!("路径不是文件：{}", path.to_string_lossy()));
        }

        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_lowercase();
        let Some(mime_type) = photo_mime(&extension) else {
            return Err(format!("不支持的格式：{}", path.to_string_lossy()));
        };

        let file_metadata =
            fs::metadata(&path).map_err(|error| format!("无法读取文件信息：{error}"))?;
        if file_metadata.len() > MAX_IMPORT_FILE_BYTES {
            return Err(format!("文件超过 128 MB 上限：{}", path.to_string_lossy()));
        }
        total_bytes = total_bytes.saturating_add(file_metadata.len());
        if total_bytes > MAX_IMPORT_TOTAL_BYTES {
            return Err("本次选择的文件总量超过 384 MB，请分批导入".to_string());
        }

        let bytes = fs::read(&path).map_err(|error| format!("无法读取文件：{error}"))?;
        let metadata = if extension == "arw" || extension == "nef" {
            read_photo_metadata(&path)
        } else {
            None
        };

        files.push(PhotoFilePayload {
            name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("photo")
                .to_string(),
            path: path.to_string_lossy().to_string(),
            size: file_metadata.len(),
            mime_type: mime_type.to_string(),
            data_base64: general_purpose::STANDARD.encode(bytes),
            metadata,
        });
    }

    Ok(files)
}

#[tauri::command]
fn record_export_job(
    app: tauri::AppHandle,
    job: serde_json::Value,
) -> Result<ProjectStoreInfo, String> {
    let connection = open_project_db(&app)?;
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("无法生成导出任务 ID：{error}"))?
        .as_millis();
    let job_id = format!("export-{now_ms}");
    let mode = job
        .get("mode")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown");
    let status = job
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown");
    let total_count = job
        .get("totalCount")
        .and_then(|value| value.as_i64())
        .unwrap_or(0);
    let completed_count = job
        .get("completedCount")
        .and_then(|value| value.as_i64())
        .unwrap_or(0);
    let failed_count = job
        .get("failedCount")
        .and_then(|value| value.as_i64())
        .unwrap_or(0);
    let output_dir = job.get("outputDir").and_then(|value| value.as_str());
    let details_json =
        serde_json::to_string(&job).map_err(|error| format!("无法序列化导出任务：{error}"))?;

    connection
        .execute(
            "
      INSERT INTO export_jobs (
        job_id, mode, status, total_count, completed_count, failed_count, output_dir, details_json
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ",
            params![
                job_id,
                mode,
                status,
                total_count,
                completed_count,
                failed_count,
                output_dir,
                details_json
            ],
        )
        .map_err(|error| format!("无法记录导出任务：{error}"))?;

    Ok(ProjectStoreInfo {
        path: project_db_path(&app)?.to_string_lossy().to_string(),
    })
}

fn list_export_jobs_from_connection(
    connection: &Connection,
    limit: i64,
) -> Result<Vec<ExportJobHistory>, String> {
    let limit = limit.clamp(1, 50);
    let mut statement = connection
    .prepare(
      "
      SELECT job_id, created_at, mode, status, total_count, completed_count, failed_count, output_dir, details_json
      FROM export_jobs
      ORDER BY created_at DESC, job_id DESC
      LIMIT ?1
      ",
    )
    .map_err(|error| format!("无法读取导出记录：{error}"))?;
    let rows = statement
        .query_map(params![limit], |row| {
            let details_json: String = row.get(8)?;
            let details = serde_json::from_str::<serde_json::Value>(&details_json)
                .unwrap_or(serde_json::Value::Null);
            Ok(ExportJobHistory {
                job_id: row.get(0)?,
                created_at: row.get(1)?,
                mode: row.get(2)?,
                status: row.get(3)?,
                total_count: row.get(4)?,
                completed_count: row.get(5)?,
                failed_count: row.get(6)?,
                output_dir: row.get(7)?,
                items: details.get("items").cloned(),
                failed: details.get("failed").cloned(),
            })
        })
        .map_err(|error| format!("无法查询导出记录：{error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法解析导出记录：{error}"))
}

fn clear_export_jobs_from_connection(connection: &Connection) -> Result<(), String> {
    connection
        .execute("DELETE FROM export_jobs", [])
        .map(|_| ())
        .map_err(|error| format!("无法清空导出记录：{error}"))
}

#[tauri::command]
fn list_export_jobs(
    app: tauri::AppHandle,
    limit: Option<i64>,
) -> Result<Vec<ExportJobHistory>, String> {
    let connection = open_project_db(&app)?;
    list_export_jobs_from_connection(&connection, limit.unwrap_or(6))
}

#[tauri::command]
fn clear_export_jobs(app: tauri::AppHandle) -> Result<ProjectStoreInfo, String> {
    let connection = open_project_db(&app)?;
    clear_export_jobs_from_connection(&connection)?;

    Ok(ProjectStoreInfo {
        path: project_db_path(&app)?.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn get_project_store_summary(app: tauri::AppHandle) -> Result<ProjectStoreSummary, String> {
    let connection = open_project_db(&app)?;
    let snapshot_updated_at = connection
        .query_row(
            "SELECT updated_at FROM project_snapshots WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .ok();

    Ok(ProjectStoreSummary {
        path: project_db_path(&app)?.to_string_lossy().to_string(),
        asset_count: count_rows(&connection, "assets")?,
        jpg_count: count_rows_where(&connection, "assets", "source_format = 'jpg'")?,
        raw_count: count_rows_where(&connection, "assets", "source_format = 'raw'")?,
        editable_count: count_rows_where(&connection, "assets", "is_editable = 1")?,
        metadata_count: count_rows(&connection, "asset_metadata")?,
        edit_count: count_rows(&connection, "edits")?,
        preset_count: count_rows(&connection, "presets")?,
        export_job_count: count_rows(&connection, "export_jobs")?,
        named_project_count: count_rows(&connection, "named_projects")?,
        snapshot_updated_at,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_export_file,
            save_project_snapshot,
            save_named_project_snapshot,
            load_project_snapshot,
            load_named_project_snapshot,
            list_named_project_snapshots,
            get_project_store_info,
            read_photo_files,
            get_project_store_summary,
            record_export_job,
            list_export_jobs,
            clear_export_jobs,
            get_ai_settings,
            save_ai_settings,
            diagnose_ai_connection,
            tune_photo_with_openai
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_job_history_lists_latest_details() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        ensure_export_jobs_schema(&connection).expect("export jobs schema should be created");
        connection
      .execute(
        "
        INSERT INTO export_jobs (
          job_id, mode, status, total_count, completed_count, failed_count, output_dir, details_json, created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ",
        params![
          "export-old",
          "single",
          "completed",
          1_i64,
          1_i64,
          0_i64,
          "C:\\old",
          r#"{"items":[{"assetId":"a","name":"old.jpg","status":"written"}],"failed":[]}"#,
          "2026-07-08 01:00:00"
        ],
      )
      .expect("old export job should insert");
        connection
      .execute(
        "
        INSERT INTO export_jobs (
          job_id, mode, status, total_count, completed_count, failed_count, output_dir, details_json, created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ",
        params![
          "export-new",
          "batch",
          "completed_with_failures",
          4_i64,
          3_i64,
          1_i64,
          "C:\\new",
          r#"{"items":[{"assetId":"b","name":"new.jpg","status":"failed","reason":"disk"}],"failed":[{"assetId":"b","name":"new.jpg","reason":"disk"}]}"#,
          "2026-07-08 02:00:00"
        ],
      )
      .expect("new export job should insert");

        let history =
            list_export_jobs_from_connection(&connection, 1).expect("export history should list");

        assert_eq!(history.len(), 1);
        assert_eq!(history[0].job_id, "export-new");
        assert_eq!(history[0].mode, "batch");
        assert_eq!(history[0].status, "completed_with_failures");
        assert_eq!(history[0].completed_count, 3);
        assert_eq!(history[0].failed_count, 1);
        assert!(history[0]
            .items
            .as_ref()
            .and_then(|value| value.as_array())
            .is_some());
        assert!(history[0]
            .failed
            .as_ref()
            .and_then(|value| value.as_array())
            .is_some());
    }

    #[test]
    fn clear_export_jobs_removes_history() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        ensure_export_jobs_schema(&connection).expect("export jobs schema should be created");
        connection
            .execute(
                "
        INSERT INTO export_jobs (
          job_id, mode, status, total_count, completed_count, failed_count, output_dir, details_json
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ",
                params![
                    "export-clear",
                    "single",
                    "completed",
                    1_i64,
                    1_i64,
                    0_i64,
                    "C:\\exports",
                    r#"{"items":[],"failed":[]}"#
                ],
            )
            .expect("export job should insert");

        clear_export_jobs_from_connection(&connection).expect("export jobs should clear");
        let history =
            list_export_jobs_from_connection(&connection, 6).expect("export history should list");

        assert!(history.is_empty());
    }

    #[test]
    fn export_file_conflict_strategies_write_expected_files() {
        let root = std::env::temp_dir().join(format!(
            "auto-photo-export-conflicts-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be valid")
                .as_millis()
        ));
        fs::create_dir_all(&root).expect("export conflict temp dir should be created");
        let output_dir = root.to_string_lossy().to_string();

        let first = save_export_file(
            output_dir.clone(),
            "photo.jpg".to_string(),
            "data:image/jpeg;base64,/9j/2Q==".to_string(),
            "rename".to_string(),
        )
        .expect("first export should be written");
        assert!(!first.skipped);
        assert_eq!(first.file_name, "photo.jpg");
        assert_eq!(
            fs::read(root.join("photo.jpg")).expect("first export bytes should read"),
            vec![0xff_u8, 0xd8, 0xff, 0xd9]
        );

        let renamed = save_export_file(
            output_dir.clone(),
            "photo.jpg".to_string(),
            "data:image/jpeg;base64,AQID".to_string(),
            "rename".to_string(),
        )
        .expect("conflicting export should be renamed");
        assert!(!renamed.skipped);
        assert_eq!(renamed.file_name, "photo (1).jpg");
        assert_eq!(
            fs::read(root.join("photo (1).jpg")).expect("renamed export bytes should read"),
            vec![1_u8, 2, 3]
        );

        let skipped = save_export_file(
            output_dir.clone(),
            "photo.jpg".to_string(),
            "data:image/jpeg;base64,BAUG".to_string(),
            "skip".to_string(),
        )
        .expect("conflicting export should be skipped");
        assert!(skipped.skipped);
        assert_eq!(skipped.file_name, "photo.jpg");
        assert_eq!(
            fs::read(root.join("photo.jpg")).expect("skipped export should keep original bytes"),
            vec![0xff_u8, 0xd8, 0xff, 0xd9]
        );

        let overwritten = save_export_file(
            output_dir.clone(),
            "photo.jpg".to_string(),
            "data:image/jpeg;base64,BAUG".to_string(),
            "overwrite".to_string(),
        )
        .expect("conflicting export should be overwritten");
        assert!(!overwritten.skipped);
        assert_eq!(overwritten.file_name, "photo.jpg");
        assert_eq!(
            fs::read(root.join("photo.jpg")).expect("overwritten export bytes should read"),
            vec![4_u8, 5, 6]
        );

        let sanitized = save_export_file(
            output_dir.clone(),
            "..bad:name".to_string(),
            "data:image/jpeg;base64,BwgJ".to_string(),
            "rename".to_string(),
        )
        .expect("unsafe export name should be sanitized and written");
        assert_eq!(sanitized.file_name, "bad_name.jpg");
        assert!(root.join("bad_name.jpg").is_file());

        fs::remove_dir_all(root).expect("export conflict temp dir should be removed");
    }

    #[test]
    fn read_photo_files_returns_selected_supported_bytes() {
        let root = std::env::temp_dir().join(format!(
            "auto-photo-selected-files-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be valid")
                .as_millis()
        ));
        fs::create_dir_all(&root).expect("selected file temp dir should be created");
        let jpg_path = root.join("sample.jpg");
        fs::write(&jpg_path, [0xff_u8, 0xd8, 0xff, 0xd9]).expect("jpg sample should be written");

        let files = read_photo_files(vec![jpg_path.to_string_lossy().to_string()])
            .expect("jpg should read");

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "sample.jpg");
        assert_eq!(files[0].mime_type, "image/jpeg");
        assert_eq!(files[0].size, 4);
        assert_eq!(files[0].data_base64, "/9j/2Q==");

        fs::remove_dir_all(root).expect("selected file temp dir should be removed");
    }
    #[test]
    fn read_photo_files_rejects_unsupported_formats() {
        let root = std::env::temp_dir().join(format!(
            "auto-photo-selected-files-reject-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be valid")
                .as_millis()
        ));
        fs::create_dir_all(&root).expect("reject temp dir should be created");
        let text_path = root.join("sample.txt");
        fs::write(&text_path, "not a photo").expect("text sample should be written");

        let result = read_photo_files(vec![text_path.to_string_lossy().to_string()]);

        assert!(result.is_err());

        fs::remove_dir_all(root).expect("reject temp dir should be removed");
    }

    #[test]
    fn snapshot_asset_counts_preserve_raw_and_jpg_formats() {
        let snapshot = serde_json::json!({
          "assets": [
            { "name": "one.jpg", "size": 10, "sourceFormat": "jpg" },
            { "name": "two.NEF", "size": 20, "sourceFormat": "raw" },
            { "name": "legacy.jpg", "size": 30 }
          ]
        });

        let (asset_count, jpg_count, raw_count) = snapshot_asset_counts(&snapshot);

        assert_eq!(asset_count, 3);
        assert_eq!(jpg_count, 2);
        assert_eq!(raw_count, 1);
    }

    #[test]
    fn ai_url_normalization_removes_sensitive_query_and_endpoint_suffixes() {
        assert_eq!(
            normalize_ai_url("https://example.test/v1/responses?api_key=secret#frag"),
            "https://example.test/v1"
        );
        assert_eq!(
            normalize_ai_url("https://example.test/v1/chat/completions?token=secret"),
            "https://example.test/v1"
        );
        assert_eq!(
            normalize_ai_url("example.test/v1/models"),
            "https://example.test/v1"
        );
    }

    #[test]
    fn ai_model_defaults_to_requested_gpt_55() {
        assert_eq!(normalize_ai_model(None), DEFAULT_AI_MODEL);
        assert_eq!(normalize_ai_model(Some("")), DEFAULT_AI_MODEL);
        assert_eq!(default_ai_settings().model, DEFAULT_AI_MODEL);
    }

    #[test]
    fn ai_model_base_candidates_try_v1_for_gateway_roots() {
        assert_eq!(
            ai_model_base_candidates("https://example.test"),
            vec![
                "https://example.test".to_string(),
                "https://example.test/v1".to_string()
            ]
        );
        assert_eq!(
            ai_model_base_candidates("https://example.test/v1"),
            vec!["https://example.test/v1".to_string()]
        );
    }

    #[test]
    fn ai_attempt_error_summary_keeps_safe_channel_context() {
        let mut errors = Vec::new();
        push_ai_attempt_error(
            &mut errors,
            "图像 Responses",
            "AI 接口返回 HTTP 415".to_string(),
        );
        push_ai_attempt_error(
            &mut errors,
            "图像 Chat Completions",
            "AI 请求网络失败或超时".to_string(),
        );
        push_ai_attempt_error(
            &mut errors,
            "文本降级 Responses",
            "AI 接口响应不是有效 JSON".to_string(),
        );
        push_ai_attempt_error(
            &mut errors,
            "Strict JSON Responses",
            "AI 返回 params 缺少可用调色字段".to_string(),
        );

        let summary = summarize_ai_attempt_errors(&errors, "fallback");

        assert!(summary.contains("AI 图像 Responses：AI 接口返回 HTTP 415"));
        assert!(summary.contains("AI 图像 Chat Completions：AI 请求网络失败或超时"));
        assert!(summary.contains("AI 文本降级 Responses：AI 接口响应不是有效 JSON"));
        assert!(summary.contains("AI Strict JSON Responses：AI 返回 params 缺少可用调色字段"));
        assert!(!summary.contains("https://"));
        assert!(!summary.contains("Bearer "));
        assert!(summary.chars().count() <= 300);
    }

    #[test]
    fn ai_settings_models_use_fetched_list_when_available() {
        let settings = AiStoredSettings {
            model: "saved-model".to_string(),
            base_url: "https://example.test/v1".to_string(),
        };

        let models = available_ai_models_with_saved_fallback(
            &settings,
            Ok(AiModelList {
                base_url: settings.base_url.clone(),
                models: vec!["remote-a".to_string(), "remote-b".to_string()],
            }),
        );

        assert_eq!(models, vec!["remote-a".to_string(), "remote-b".to_string()]);
    }

    #[test]
    fn ai_settings_models_fall_back_to_saved_model_when_fetch_fails() {
        let settings = AiStoredSettings {
            model: "saved-model".to_string(),
            base_url: "https://example.test/v1".to_string(),
        };

        let models = available_ai_models_with_saved_fallback(
            &settings,
            Err("network unavailable".to_string()),
        );

        assert_eq!(models, vec!["saved-model".to_string()]);
    }

    #[test]
    fn ai_connection_diagnostic_reports_safe_model_status() {
        let passed = build_ai_connection_diagnostic(
            AiStoredSettings {
                model: "selected-model".to_string(),
                base_url: "https://private.example.test/v1".to_string(),
            },
            true,
            Ok(AiModelList {
                base_url: "https://private.example.test/v1".to_string(),
                models: vec!["selected-model".to_string(), "other-model".to_string()],
            }),
        );
        assert_eq!(passed.status, "passed");
        assert!(passed.has_api_key);
        assert!(passed.model_available);
        assert_eq!(passed.model_count, 2);
        assert!(!passed.message.contains("private.example.test"));

        let missing_model = build_ai_connection_diagnostic(
            AiStoredSettings {
                model: "selected-model".to_string(),
                base_url: "https://private.example.test/v1".to_string(),
            },
            true,
            Ok(AiModelList {
                base_url: "https://private.example.test/v1".to_string(),
                models: vec!["other-model".to_string()],
            }),
        );
        assert_eq!(missing_model.status, "failed");
        assert!(missing_model.has_api_key);
        assert!(!missing_model.model_available);
        assert_eq!(missing_model.model_count, 1);
        assert!(missing_model.message.contains("当前模型不在模型列表中"));
        assert!(!missing_model.message.contains("private.example.test"));

        let no_key = build_ai_connection_diagnostic(
            AiStoredSettings {
                model: "selected-model".to_string(),
                base_url: "https://private.example.test/v1".to_string(),
            },
            false,
            Err("AI key 尚未保存".to_string()),
        );
        assert_eq!(no_key.status, "failed");
        assert!(!no_key.has_api_key);
        assert_eq!(no_key.model_count, 0);
        assert!(!no_key.message.contains("private.example.test"));
    }

    #[test]
    fn stored_ai_settings_reload_normalizes_model_and_base_url() {
        let root = std::env::temp_dir().join(format!(
            "auto-photo-ai-settings-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be valid")
                .as_millis()
        ));
        fs::create_dir_all(&root).expect("ai settings temp dir should be created");
        let settings_path = root.join("ai-settings.json");
        fs::write(
            &settings_path,
            serde_json::json!({
                "model": "  gpt-5.5  ",
                "baseUrl": "https://example.test/v1/models?api_key=must-not-keep"
            })
            .to_string(),
        )
        .expect("ai settings should be written");

        let settings = load_stored_ai_settings_from_path(&settings_path);

        assert_eq!(settings.model, DEFAULT_AI_MODEL);
        assert_eq!(settings.base_url, "https://example.test/v1");
        fs::remove_dir_all(root).expect("ai settings temp dir should be removed");
    }

    #[test]
    fn stored_ai_settings_reload_falls_back_on_invalid_json() {
        let root = std::env::temp_dir().join(format!(
            "auto-photo-ai-settings-invalid-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be valid")
                .as_millis()
        ));
        fs::create_dir_all(&root).expect("invalid ai settings temp dir should be created");
        let settings_path = root.join("ai-settings.json");
        fs::write(&settings_path, "{not-json").expect("invalid ai settings should be written");

        let settings = load_stored_ai_settings_from_path(&settings_path);

        assert_eq!(settings.model, default_ai_settings().model);
        assert_eq!(settings.base_url, default_ai_settings().base_url);
        fs::remove_dir_all(root).expect("invalid ai settings temp dir should be removed");
    }
}
