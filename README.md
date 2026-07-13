# AutoPhoto 自动调色客户端

AutoPhoto 是一款桌面照片编辑软件，面向摄影师、修图师和影像团队，提供本地调色、AI 辅助调色、预设风格、旋转裁切、分屏对比和 JPG 导出流程。

它的核心目标很直接：导入照片，快速调整颜色，检查前后效果，把同一套风格应用到一组照片，并导出成品 JPG。

## 软件截图
<img width="1920" height="1050" alt="全局截图" src="https://github.com/user-attachments/assets/cc7deb00-5100-4fcf-a06b-1e836049aeac" />

<img width="3456" height="1996" alt="AI调色" src="https://github.com/user-attachments/assets/d8bd799d-8363-4b75-961e-3153232dfb9d" />

<img width="2628" height="1802" alt="人像对比" src="https://github.com/user-attachments/assets/d205da6a-c36f-401e-ab38-43f9c0248285" />

<img width="3374" height="1084" alt="对比图" src="https://github.com/user-attachments/assets/89abd608-d329-4628-81e1-20b531f87fd8" />


## 功能

- 导入 JPG/JPEG 照片，以及支持的 Sony/Nikon RAW 文件。
- 读取可用的基础相机元数据。
- 一键自动调色。
- 手动调整曝光、白平衡、色调、对比度、高光、阴影、饱和度、自然饱和度、清晰度、纹理、去雾、暗角、颗粒、锐化、降噪、画质增强、人像参数和 HSL 分色。
- 提供人像、风光、建筑、城市、个性等预设系列，并显示当前选中的滤镜。
- 支持通过眼睛按钮查看原图和编辑后效果对比。
- 支持照片旋转、常见比例裁切和自由裁切。
- 支持复制/粘贴调色参数、撤销和重做。
- 支持参考图风格，让当前照片向参考照片靠近。
- 在用户提供 AI 配置后，可使用 AI 调色和 AI 追色；AI 调色会提供多组方案供用户预览后选择。
- 本地保存和重新载入项目编辑状态。
- 支持当前照片或批量导出 JPG，并可设置命名、质量、尺寸、EXIF、水印和同名文件策略。

## 平台说明

- Windows 桌面版：支持 JPG/JPEG、Sony ARW 和 Nikon NEF，提供完整工作台、批量处理、项目保存、导出目录选择和安装包发布。
- macOS 桌面版：提供 Apple Silicon 安装包，功能与桌面工作台一致。
- Android / iPhone 移动端：提供触屏排版，只处理 JPG/JPEG；支持导入、预设、手动滑杆和数值输入、HSL、AI 调色、旋转裁切、降噪、画质增强、撤销、缩放、眼睛对比和 JPG 导出。
- 浏览器预览：可用于快速体验界面和基础流程，正式使用建议下载对应平台安装包。

GitHub Release 会生成 Windows、macOS 和移动端构建产物。Android 只发布一个签名后的正式 APK 安装包；iOS 只发布签名后的 IPA，必须配置 Apple 签名证书和描述文件后才会生成。

Android APK 会在 CI 中签名后发布；如果没有配置正式 keystore secrets，工作流会临时生成安装用签名密钥，保证 APK 可以直接安装，但跨版本覆盖升级可能需要先卸载旧包。需要稳定升级时，配置 `ANDROID_KEY_BASE64`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`，如果 keystore 密码不同再配置 `ANDROID_KEYSTORE_PASSWORD`。iOS IPA 仍需配置 `IOS_CERTIFICATE`、`IOS_CERTIFICATE_PASSWORD`、`IOS_MOBILE_PROVISION` 后才会生成。

## 基本使用

1. 启动 AutoPhoto。
2. 通过导入按钮或拖放导入照片。
3. 从图库中选择一张照片。
4. 使用自动调色、选择预设，或通过滑杆和数值输入微调参数。
5. 点击眼睛按钮查看前后对比。
6. 根据需要旋转、裁切、复制参数，或使用参考图风格工具。
7. 如果需要 AI 调色或 AI 追色，在 AI 设置中填写自己的配置。
8. 设置导出参数，导出当前照片或批量导出选中的照片。

## AI 配置

AI 功能是可选能力。用户可以在软件内的 AI 设置区域填写自己的 API key、Base URL 和模型名称。

AI 调色和 AI 追色只会在用户主动点击后运行。即使不配置 AI，AutoPhoto 仍然可以完成本地调色、预设、裁切、旋转、对比和导出流程。

## 移动端使用

移动端界面面向 Android 和 iPhone 的触屏操作，当前只接受 JPG/JPEG 图片。导入照片后，可以在底部工具栏切换 AI、预设、调色、HSL、裁切和增强；右下角提供缩放和眼睛对比按钮，顶部提供返回上一步和导出入口。

移动端预设会显示当前选中的滤镜。只要用户继续手动调色、运行 AI、本地自动校正或撤销/重做，当前滤镜标识会自动取消，避免误判当前效果仍然是单一滤镜。

## 许可证

请查看 [LICENSE](LICENSE)。
