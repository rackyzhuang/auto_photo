# AutoPhoto 自动调色客户端

AutoPhoto 是一款本地优先的专业相机照片自动调色桌面客户端。它面向摄影师、修图师和影像工作室，支持导入 Sony/Nikon 相机 JPG 和 RAW，读取基础 EXIF 信息，进行非破坏式调色、手动微调、AI 调色候选、AI 追色、批量统一、参考图风格迁移和 JPG 导出。

项目目标是交付可在 Windows 和 macOS 运行的桌面软件。技术栈为 React、TypeScript、Vite、Tauri v2、Rust 和 SQLite。

## 当前状态

- 已支持 JPG/JPEG 文件选择导入、拖拽导入、EXIF 读取、预览渲染和重复文件检测。
- 已支持 Sony/Nikon 相机识别和本地自动调色。
- 已支持基础调色滑杆、数值输入、HSL 分色、系列预设、复制/粘贴参数、撤销/重做和前后对比。
- 已支持 AI 设置、AI 调色、AI 追色、本地色彩科学兜底候选、批量 AI 调色和批量 AI 追色。
- 已支持批量自动调色、批量一致性预览、参考图风格应用、导出设置、水印、导出目录提示和导出历史。
- 已支持 SQLite 项目快照和命名项目。
- RAW `.ARW` 和 `.NEF` 当前可以导入；当文件中存在可用内嵌 JPEG 预览时，支持预览级手动调色、HSL、预设、AI 调色、AI 追色、参考风格和单张 JPG 导出。
- 完整 RAW 显影、RAW/TIFF 输出、RAW 深度 EXIF/XMP 保留和 RAW 批量导出尚未实现。
- 当前工作区已验证 Windows 构建；macOS 的 `.app` 和 `.dmg` 必须在 macOS 机器上构建和验证。

## 环境要求

- Node.js
- npm
- Rust stable 工具链
- 平台构建工具：
  - Windows：Visual Studio Build Tools，并安装 MSVC C++ 工具链
  - macOS：Xcode Command Line Tools

## 安装依赖

```bash
npm install
```

## 浏览器开发模式

```bash
npm run dev
```

启动后打开终端里显示的 Vite 本地地址。浏览器模式适合开发和调试 UI，但选择桌面导出目录等能力需要 Tauri 桌面模式。

## 桌面开发模式

```bash
npm run desktop:dev
```

该命令会启动 Vite 开发服务，并打开 Tauri 桌面应用。

## 构建命令

前端生产构建：

```bash
npm run build
```

TypeScript 类型检查：

```bash
npm run typecheck
```

核心本地回归检查：

```bash
npm run check:core
```

该命令会运行 TypeScript 检查、AI 脱敏检查、AI 设置入口/keychain 检查、分屏对比布局体验检查、RAW/JPG fixture 检查、桌面导入 payload 检查、导入拖放体验检查、导出位置体验检查、导出队列检查、内置预设结构、渲染和 contact sheet 产物检查、前端生产构建和构建后的隐私扫描。远端 AI smoke、Rust 测试和 Tauri 桌面构建仍然是单独的完整验收步骤。

固定 JPG/RAW 样张的真实桌面导入路径检查：

```bash
npm run check:desktop-import-paths
```

该命令会把真实 Nikon/Sony fixture 路径传给 Rust 桌面导入单测，验证本地文件系统路径下的 JPG、Nikon NEF、Sony ARW 可以读取 payload 和安全相机元数据。它会运行 Cargo，因此暂不放进 `check:core`。

生成预设视觉复核 contact sheet：

```bash
npm run generate:preset-contact-sheets
```

该命令会在 `remark-V2/artifacts/preset-contact-sheets/` 下生成固定样张 JPG 拼图和格子 manifest，用于人工复核内置预设的视觉方向。

Rust 后端检查：

```bash
cd src-tauri
cargo check
```

构建桌面可执行文件，不生成安装包：

```bash
npm run desktop:build:no-bundle
```

构建 Windows 安装包：

```bash
npm run desktop:build:windows
```

构建 macOS `.app` 和 `.dmg`：

```bash
npm run desktop:build:mac
```

macOS 构建必须在 macOS 主机上执行。面向真实用户发布前，还需要补齐 Apple Developer 签名、公证和 Gatekeeper 验证流程。

## 基本使用流程

1. 启动应用。
2. 使用导入按钮或拖拽导入 JPG/JPEG 照片，或导入支持的 Sony/Nikon RAW 文件。
3. 从图库或底部胶片栏选择照片。
4. 点击一键自动调色，生成初始调色参数。
5. 根据需要微调曝光、色温、色调、对比度、高光、阴影、饱和度、自然饱和度、清晰度、纹理、去雾、暗角、颗粒、锐化、降噪、人像参数或 HSL 分色。
6. 使用前后对比检查效果。
7. 如需远端 AI 建议，在 AI 面板保存配置；AI 只会在用户点击 AI 调色或 AI 追色时触发。
8. 保存预设，或复制当前参数并粘贴到其他照片。
9. 对一组照片使用批量自动、批量 AI、统一色彩或参考图风格工具。
10. 配置导出质量、最长边、文件命名、同名策略、EXIF 保留和文字水印。
11. 导出当前照片或批量导出选中的照片。

## 项目存储

桌面应用会在 Tauri 应用数据目录中使用本地 SQLite 数据库存储项目快照。项目快照保存的是调色参数、导出设置、预设、参考风格和资产身份信息，不保存原图二进制。

命名项目可以在项目库中保存和载入。载入命名项目时，只会恢复已经重新导入并能匹配上的照片参数；缺失的原图不会被自动找回。

## 导出说明

- 原图永不覆盖。
- 桌面模式可以选择导出目录并写入 JPG 文件。
- 浏览器模式会降级为浏览器下载，无法完全控制同名文件行为。
- 桌面导出支持自动重命名、跳过同名和覆盖同名三种策略。
- 导出历史会记录每张照片的写入、跳过和失败明细。
- RAW 导出是基于 RAW 内嵌 JPEG 预览的预览级 JPG 导出，不是完整 RAW 显影输出。

## 隐私和本地文件

- 图片处理默认本地优先。
- 应用不得默认上传用户照片。
- AI 调用必须由用户手动触发，只发送当前操作所需的压缩预览图和基础元数据。
- 桌面应用的 AI API key 使用系统钥匙串保存，不得写入 SQLite、项目快照、日志、文档或安装包。
- `openAi.json` 是本地私密测试配置。不得提交、打印、写入日志、写入文档、写入 SQLite 或打包进安装包。
- `.gitignore` 已忽略 `openAi.json`、缓存目录、导出目录、构建产物和 SQLite 文件。

## 双平台验证清单

Windows 和 macOS 都需要验证：

- 应用可以正常启动。
- JPG 导入支持普通路径和中文路径。
- 有 EXIF 的照片可以显示基础元数据。
- 自动调色和手动调色能更新预览。
- 有内嵌 JPEG 预览的 RAW 可以预览、进行预览级调色，并导出为 JPG。
- AI 设置可以保存，重启后仍可恢复，且 API key 不进入项目数据或安装包。
- AI 失败时显示安全、分类后的失败原因和处理建议，并回退本地色彩科学候选；兼容 OpenAI 的网关会在需要时同时尝试已保存 Base URL 和 `/v1` 候选。
- 项目快照可以保存和载入。
- 命名项目可以保存和载入。
- 桌面导出目录选择可用。
- 导出的 JPG 符合命名、质量、最长边、水印、EXIF 和同名策略设置。
- 内置预设覆盖人像、风光、建筑、城市、个性五个系列，参数范围合法，并能在固定 JPG 样张上完成有效渲染。
- 发布候选构建前，`npm run check:desktop-import-paths` 可以通过固定 Nikon/Sony JPG/RAW 本地路径检查。
- `openAi.json` 没有进入安装包或应用 bundle。
- 发布候选构建前 `npm run check:core` 可以通过。

## 当前限制

- RAW 支持目前是内嵌 JPEG 预览级能力；完整 RAW 显影、RAW/TIFF 输出、RAW 深度元数据保留和 RAW 批量导出仍是后续工作。
- 大批量图像处理仍主要运行在前端流程中，后续应迁移到 Web Worker 或 Rust 后台任务。
- 精确 EXIF 重写尚未完成；当前 JPG 导出可以保留安全的 EXIF APP1 数据，并在可安全解析时归一 Orientation。
- macOS 打包必须在真实 macOS 主机上验证。
