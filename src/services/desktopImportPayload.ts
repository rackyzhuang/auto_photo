import type { DesktopPhotoFile } from "./desktopBridge";

interface DesktopPayloadFileOptions {
  lastModified?: number;
}

export const desktopPhotoPayloadToFile = (
  photo: DesktopPhotoFile,
  options: DesktopPayloadFileOptions = {}
): File => {
  if (!photo.dataBase64) throw new Error(`${photo.name} 读取结果为空`);

  const binary = atob(photo.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  if (photo.size > 0 && bytes.length !== photo.size) {
    throw new Error(`${photo.name} 读取字节数不一致：${bytes.length}/${photo.size}`);
  }

  return new File([bytes], photo.name, {
    type: photo.mimeType,
    lastModified: options.lastModified ?? Date.now()
  });
};
