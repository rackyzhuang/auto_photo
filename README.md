# AutoPhoto 自动调色客户端

AutoPhoto 是一款桌面照片编辑软件，面向摄影师、修图师和影像团队，提供本地调色、AI 辅助调色、预设风格、旋转裁切、分屏对比和 JPG 导出流程。

它的核心目标很直接：导入照片，快速调整颜色，检查前后效果，把同一套风格应用到一组照片，并导出成品 JPG。

## 功能

- 导入 JPG/JPEG 照片，以及支持的 Sony/Nikon RAW 文件。
- 读取可用的基础相机元数据。
- 一键自动调色。
- 手动调整曝光、白平衡、色调、对比度、高光、阴影、饱和度、自然饱和度、清晰度、纹理、去雾、暗角、颗粒、锐化、降噪、人像参数和 HSL 分色。
- 提供人像、风光、建筑、城市、个性等预设系列。
- 支持原图和编辑后效果对比。
- 支持照片旋转、常见比例裁切和自由裁切。
- 支持复制/粘贴调色参数、撤销和重做。
- 支持参考图风格，让当前照片向参考照片靠近。
- 在用户提供 AI 配置后，可使用 AI 调色和 AI 追色。
- 本地保存和重新载入项目编辑状态。
- 支持当前照片或批量导出 JPG，并可设置命名、质量、尺寸、EXIF、水印和同名文件策略。

## 基本使用

1. 启动 AutoPhoto。
2. 通过导入按钮或拖放导入照片。
3. 从图库中选择一张照片。
4. 使用自动调色、选择预设，或手动拖动参数滑杆。
5. 使用前后对比检查效果。
6. 根据需要旋转、裁切、复制参数，或使用参考图风格工具。
7. 如果需要 AI 调色或 AI 追色，在 AI 设置中填写自己的配置。
8. 设置导出参数，导出当前照片或批量导出选中的照片。

## AI 配置

AI 功能是可选能力。用户可以在软件内的 AI 设置区域填写自己的 API key、Base URL 和模型名称。

AI 调色和 AI 追色只会在用户主动点击后运行。即使不配置 AI，AutoPhoto 仍然可以完成本地调色、预设、裁切、旋转、对比和导出流程。

## 从源码运行

环境要求：

- Node.js
- npm
- Rust stable 工具链
- Windows：Visual Studio Build Tools，并安装 MSVC C++ 工具
- macOS：Xcode Command Line Tools

安装依赖：

```bash
npm install
```

启动浏览器开发服务：

```bash
npm run dev
```

启动桌面开发模式：

```bash
npm run desktop:dev
```

构建前端生产版本：

```bash
npm run build
```

运行 TypeScript 检查：

```bash
npm run typecheck
```

构建桌面应用：

```bash
npm run desktop:build
```

构建 Windows 安装包：

```bash
npm run desktop:build:windows
```

在 macOS 上构建 `.app` 和 `.dmg`：

```bash
npm run desktop:build:mac
```

## 许可证

请查看 [LICENSE](LICENSE)。
