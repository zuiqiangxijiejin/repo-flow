# RepoFlow 前端

工作区基于 Next.js、React、TypeScript 和 Tailwind CSS。页面包含账号登录、仓库对话、流式执行记录、Git 审阅、设置与可选功能目录。

## 本地运行

在项目根目录使用 `make dev` 启动完整服务，通过 nginx 的统一入口访问。仅开发前端时可在本目录使用 `pnpm dev`，但 API 仍需要运行中的 Gateway。

```bash
pnpm check
pnpm test
pnpm test:e2e
pnpm build
```

主机上的 pnpm 命令也可以从项目根目录通过 `python3 scripts/pnpm.py <命令>` 运行。浏览器测试模拟 API；真实后端测试单独配置。

## Project structure

| 路径 | 内容 |
| --- | --- |
| `src/app` | 路由与页面 |
| `src/components/workspace` | 导航、输入、消息、面板、设置和能力目录 |
| `src/components/ui`、`src/components/ai-elements` | 生成的基础组件 |
| `src/core` | API、账号、模型能力、消息处理与扩展加载 |
| `src/content` | 可选的内置中英文文档站 |
| `tests/unit`、`tests/e2e` | 单元测试和浏览器测试 |

界面约定见 [DESIGN.md](DESIGN.md)，编辑前阅读 [AGENTS.md](AGENTS.md)。产品文档见[项目文档目录](../docs/README.md)。
