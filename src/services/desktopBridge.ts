import { invoke, isTauri as detectTauriRuntime } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow, type DragDropEvent } from "@tauri-apps/api/window";
import type {
  AiConnectionDiagnostic,
  AiSettingsState,
  AiTuningMode,
  AiTuningResult,
  EditParams,
  ExportConflictStrategy,
  ExportJobHistory,
  ExportJobRecord,
  NamedProjectInfo,
  PhotoMetadata,
  ProjectSnapshot,
  ProjectStoreSummary
} from "../types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isTauriRuntime = () =>
  typeof window !== "undefined" && (detectTauriRuntime() || Boolean(window.__TAURI_INTERNALS__));

export const chooseExportDirectory = async (): Promise<string | undefined> => {
  if (!isTauriRuntime()) return undefined;
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择导出文件夹"
  });
  return typeof selected === "string" ? selected : undefined;
};

export const choosePhotoFilePaths = async (): Promise<string[]> => {
  if (!isTauriRuntime()) return [];
  const selected = await open({
    directory: false,
    multiple: true,
    title: "选择 Sony/Nikon JPG 或 RAW",
    filters: [
      {
        name: "Sony/Nikon JPG or RAW",
        extensions: ["jpg", "jpeg", "arw", "nef"]
      }
    ]
  });
  if (Array.isArray(selected)) return selected.filter((path): path is string => typeof path === "string");
  return typeof selected === "string" ? [selected] : [];
};

export const chooseReferencePhotoFilePath = async (): Promise<string | undefined> => {
  if (!isTauriRuntime()) return undefined;
  const selected = await open({
    directory: false,
    multiple: false,
    title: "选择 AI 追色参考图",
    filters: [
      {
        name: "JPG or RAW reference",
        extensions: ["jpg", "jpeg", "arw", "nef"]
      }
    ]
  });
  return typeof selected === "string" ? selected : undefined;
};

export interface SavedExportResult {
  path: string;
  skipped: boolean;
  fileName: string;
}

export interface DesktopPhotoFile {
  name: string;
  path: string;
  size: number;
  mimeType: string;
  dataBase64: string;
  metadata?: PhotoMetadata;
}

export const readPhotoFiles = async (filePaths: string[]): Promise<DesktopPhotoFile[]> => {
  if (!isTauriRuntime() || filePaths.length === 0) return [];
  return invoke<DesktopPhotoFile[]>("read_photo_files", {
    filePaths
  });
};

export const onDesktopPhotoDragDrop = async (
  handler: (event: DragDropEvent) => void | Promise<void>
): Promise<(() => void) | undefined> => {
  if (!isTauriRuntime()) return undefined;
  const unlisten = await getCurrentWindow().onDragDropEvent((event) => {
    void handler(event.payload);
  });
  return unlisten;
};

export const saveExportFile = async (
  outputDir: string,
  fileName: string,
  dataUrl: string,
  conflictStrategy: ExportConflictStrategy
): Promise<SavedExportResult> => {
  return invoke<SavedExportResult>("save_export_file", {
    outputDir,
    fileName,
    dataUrl,
    conflictStrategy
  });
};

export const saveProjectSnapshotToDb = async (snapshot: ProjectSnapshot): Promise<string> => {
  const result = await invoke<{ path: string }>("save_project_snapshot", {
    snapshot
  });
  return result.path;
};

export const loadProjectSnapshotFromDb = async (): Promise<ProjectSnapshot | undefined> => {
  const result = await invoke<ProjectSnapshot | null>("load_project_snapshot");
  return result ?? undefined;
};

export const saveNamedProjectSnapshot = async (name: string, snapshot: ProjectSnapshot): Promise<NamedProjectInfo> => {
  return invoke<NamedProjectInfo>("save_named_project_snapshot", {
    name,
    snapshot
  });
};

export const listNamedProjectSnapshots = async (): Promise<NamedProjectInfo[]> => {
  return invoke<NamedProjectInfo[]>("list_named_project_snapshots");
};

export const loadNamedProjectSnapshot = async (projectId: string): Promise<ProjectSnapshot | undefined> => {
  const result = await invoke<ProjectSnapshot | null>("load_named_project_snapshot", {
    projectId
  });
  return result ?? undefined;
};

export const getProjectStorePath = async (): Promise<string> => {
  const result = await invoke<{ path: string }>("get_project_store_info");
  return result.path;
};

export const getProjectStoreSummary = async (): Promise<ProjectStoreSummary> => {
  return invoke<ProjectStoreSummary>("get_project_store_summary");
};

export const recordExportJob = async (job: ExportJobRecord): Promise<string> => {
  const result = await invoke<{ path: string }>("record_export_job", {
    job
  });
  return result.path;
};

export const listExportJobs = async (limit = 6): Promise<ExportJobHistory[]> => {
  if (!isTauriRuntime()) return [];
  return invoke<ExportJobHistory[]>("list_export_jobs", {
    limit
  });
};

export const clearExportJobs = async (): Promise<string> => {
  const result = await invoke<{ path: string }>("clear_export_jobs");
  return result.path;
};

export const getAiSettings = async (): Promise<AiSettingsState> => {
  return invoke<AiSettingsState>("get_ai_settings");
};

export const saveAiSettings = async (settings: {
  apiKey?: string;
  model?: string;
  baseUrl: string;
}): Promise<AiSettingsState> => {
  return invoke<AiSettingsState>("save_ai_settings", {
    settings
  });
};

export const diagnoseAiConnection = async (): Promise<AiConnectionDiagnostic> => {
  return invoke<AiConnectionDiagnostic>("diagnose_ai_connection");
};

export const tunePhotoWithAi = async (request: {
  mode: AiTuningMode;
  assetName: string;
  cameraSummary: string;
  imageDataUrl: string;
  referenceDataUrl?: string;
  userInstruction?: string;
  currentParams: EditParams;
}): Promise<AiTuningResult> => {
  return invoke<AiTuningResult>("tune_photo_with_openai", {
    request
  });
};
