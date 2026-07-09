import type { EditParams, Preset, ReferenceColorSignature, WorkflowSettings } from "../types";
import { normalizeEditParams } from "./editParams";

const STORAGE_KEY = "auto-photo-client:v1";

interface StoredState {
  selectedAssetId?: string;
  editsByAssetName: Record<string, EditParams>;
  customPresets?: Preset[];
  workflowSettings: WorkflowSettings;
  referenceStyle?: {
    name: string;
    edits: EditParams;
    signature?: ReferenceColorSignature;
  };
}

const clampPercent = (value: unknown, fallback: number, min: number, max: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
};

const normalizeWorkflowSettings = (settings?: Partial<WorkflowSettings>): WorkflowSettings => ({
  referenceStrength: clampPercent(settings?.referenceStrength, 65, 20, 100),
  consistencyStrength: clampPercent(settings?.consistencyStrength, 65, 25, 100)
});

const createDefaultStoredState = (): StoredState => ({
  editsByAssetName: {},
  customPresets: [],
  workflowSettings: normalizeWorkflowSettings()
});

export const loadStoredState = (): StoredState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultStoredState();
    const parsed = JSON.parse(raw) as StoredState;
    const editsByAssetName = Object.fromEntries(
      Object.entries(parsed.editsByAssetName ?? {}).map(([name, edits]) => [name, normalizeEditParams(edits)])
    );
    return {
      selectedAssetId: parsed.selectedAssetId,
      editsByAssetName,
      customPresets: parsed.customPresets ?? [],
      workflowSettings: normalizeWorkflowSettings(parsed.workflowSettings),
      referenceStyle: parsed.referenceStyle
        ? {
            ...parsed.referenceStyle,
            edits: normalizeEditParams(parsed.referenceStyle.edits)
          }
        : undefined
    };
  } catch {
    return createDefaultStoredState();
  }
};

export const saveStoredState = (state: StoredState) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};
