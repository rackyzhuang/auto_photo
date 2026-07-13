export type AppPlatform = "desktop" | "android" | "ios" | "browser";

export interface PlatformCapabilities {
  id: AppPlatform;
  label: string;
  isMobile: boolean;
  usesMobileLayout: boolean;
  supportsJpg: boolean;
  supportsRaw: boolean;
  supportsDragDropImport: boolean;
  supportsDesktopPaths: boolean;
  supportsBatchJpg: boolean;
  supportsBatchAi: boolean;
  supportsSecureAiSettings: boolean;
  photoAccept: string;
  photoHint: string;
  referenceAccept: string;
  exportTargets: string[];
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const platformIds: AppPlatform[] = ["desktop", "android", "ios", "browser"];

const isPlatformId = (value: string | null): value is AppPlatform =>
  Boolean(value && platformIds.includes(value as AppPlatform));

const getPlatformOverride = (): AppPlatform | undefined => {
  if (typeof window === "undefined") return undefined;
  const queryPlatform = new URLSearchParams(window.location.search).get("platform");
  if (isPlatformId(queryPlatform)) return queryPlatform;
  const storedPlatform = window.localStorage.getItem("autophoto.platform");
  return isPlatformId(storedPlatform) ? storedPlatform : undefined;
};

export const getAppPlatform = (): AppPlatform => {
  const override = getPlatformOverride();
  if (override) return override;
  if (typeof navigator === "undefined") return "browser";

  const userAgent = navigator.userAgent.toLowerCase();
  const isIpadDesktopMode = userAgent.includes("macintosh") && navigator.maxTouchPoints > 1;
  if (userAgent.includes("android")) return "android";
  if (/iphone|ipad|ipod/.test(userAgent) || isIpadDesktopMode) return "ios";
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ ? "desktop" : "browser";
};

export const getPlatformCapabilities = (platform = getAppPlatform()): PlatformCapabilities => {
  if (platform === "android" || platform === "ios") {
    return {
      id: platform,
      label: platform === "android" ? "Android" : "iPhone",
      isMobile: true,
      usesMobileLayout: true,
      supportsJpg: true,
      supportsRaw: false,
      supportsDragDropImport: false,
      supportsDesktopPaths: false,
      supportsBatchJpg: true,
      supportsBatchAi: false,
      supportsSecureAiSettings: true,
      photoAccept: ".jpg,.jpeg,image/jpeg",
      photoHint: "选择 JPG 照片开始调色",
      referenceAccept: ".jpg,.jpeg,image/jpeg",
      exportTargets: platform === "android" ? ["相册", "下载目录", "分享"] : ["相册", "文件", "分享"]
    };
  }

  if (platform === "desktop") {
    return {
      id: "desktop",
      label: "Desktop",
      isMobile: false,
      usesMobileLayout: false,
      supportsJpg: true,
      supportsRaw: true,
      supportsDragDropImport: true,
      supportsDesktopPaths: true,
      supportsBatchJpg: true,
      supportsBatchAi: false,
      supportsSecureAiSettings: true,
      photoAccept: ".jpg,.jpeg,.arw,.nef,image/jpeg",
      photoHint: "拖入 Sony/Nikon JPG 或 RAW",
      referenceAccept: ".jpg,.jpeg,.arw,.nef,image/jpeg",
      exportTargets: ["用户选择的文件夹"]
    };
  }

  return {
    id: "browser",
    label: "Browser",
    isMobile: false,
    usesMobileLayout: false,
    supportsJpg: true,
    supportsRaw: true,
    supportsDragDropImport: true,
    supportsDesktopPaths: false,
    supportsBatchJpg: true,
    supportsBatchAi: false,
    supportsSecureAiSettings: false,
    photoAccept: ".jpg,.jpeg,.arw,.nef,image/jpeg",
    photoHint: "选择 JPG 或 RAW 预览开发效果",
    referenceAccept: ".jpg,.jpeg,.arw,.nef,image/jpeg",
    exportTargets: ["浏览器下载"]
  };
};

export const isMobilePlatform = (platform = getAppPlatform()) => platform === "android" || platform === "ios";
