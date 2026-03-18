# Contributing / 贡献指南

Thank you for your interest in contributing to OpenClaw Command Center!

感谢你对 OpenClaw 指挥中心的关注！

## How to Contribute / 如何贡献

### Reporting Bugs / 报告 Bug

1. Search [existing issues](https://github.com/tywang2006/openclaw-command-center/issues) to avoid duplicates
2. Open a new issue using the **Bug Report** template
3. Include steps to reproduce, expected vs actual behavior, and environment info

1. 先搜索[已有 issue](https://github.com/tywang2006/openclaw-command-center/issues) 避免重复
2. 使用 **Bug Report** 模板创建新 issue
3. 包含复现步骤、预期行为 vs 实际行为、环境信息

### Suggesting Features / 建议功能

Open an issue using the **Feature Request** template. Describe the use case and expected behavior.

使用 **Feature Request** 模板创建 issue，描述使用场景和期望行为。

### Pull Requests / 提交 PR

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Ensure the build passes: `npm run build`
5. Commit with a descriptive message
6. Open a PR against `master`

### Development Setup / 开发环境

```bash
git clone https://github.com/tywang2006/openclaw-command-center.git
cd openclaw-command-center
npm install
npm run dev      # Vite dev server (frontend)
npm run server   # Express backend
```

### Code Style / 代码风格

- **Frontend**: TypeScript + React 19, functional components
- **Backend**: JavaScript (ES modules), Express 5
- **UI language**: Chinese (zh) is primary, English (en) secondary
- **No emoji** in code or commit messages
- Keep changes focused — one feature/fix per PR

### License / 许可

By contributing, you agree that your contributions will be licensed under the [Elastic License 2.0](LICENSE).

提交贡献即表示你同意你的贡献将按 [Elastic License 2.0](LICENSE) 许可。
