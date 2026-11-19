# RepoFlow 项目架构

RepoFlow 将仓库任务、模型对话、代码审阅和贡献发布组合为一个 Web 工作区。仓库协作作为打包扩展接入，核心服务提供认证、对话、模型、执行与持久化能力。

## 技术栈

| 层次 | 实现 |
| --- | --- |
| 前端 | Next.js 16、React 19、TypeScript、Tailwind CSS 4 |
| 交互与组件 | Radix、Lucide、流式消息、可调整面板 |
| 后端 | Python 3.12+、FastAPI、Uvicorn |
| Agent 运行时 | LangGraph、LangChain、工具和中间件 |
| 数据 | SQLAlchemy；当前可使用 SQLite，部署也支持其他配置后端 |
| 仓库与贡献 | Git、GitHub API、账号连接、独立贡献分支 |
| 远程执行 | SSH 主机配置与账号隔离的凭据存储 |
| 扩展 UI | ES Modules、清单与 Shadow DOM，由 Gateway 分发 |
| 服务入口 | nginx 汇总前端和 API |

确切依赖版本以 `frontend/package.json`、`frontend/pnpm-lock.yaml`、`backend/pyproject.toml` 和 `backend/uv.lock` 为准。

## 主要目录

| 路径 | 责任 |
| --- | --- |
| `frontend/src/app` | 页面与路由 |
| `frontend/src/components/workspace` | 工作区、输入框、消息、设置和面板 |
| `frontend/src/core` | API、权限、模型能力、扩展和状态逻辑 |
| `backend/app/gateway` | HTTP API、认证和运行入口 |
| `backend/packages/harness` | Agent、工具、沙箱和持久化 |
| `backend/packages/extension-api` | 扩展契约 |
| `examples/deerflow-extension-repository-tasks` | 仓库任务、GitHub、SSH 与 Git 发布扩展 |
| `docs/guide` | 当前用户与维护者文档 |
| `scripts`、`docker`、`deploy` | 启动、部署和检查 |

现有包名、导入名、环境变量和数据目录是运行契约，升级时保留兼容性，不能仅按产品名称做全文替换。

## 数据流

浏览器通过 nginx 请求 Gateway。Gateway 验证会话与权限，启动或恢复运行，并持久化对话事件；Agent 经工具访问对应的沙箱或仓库工作区。前端接收流式事件，刷新真实执行记录与审阅状态。

Git 推送与 PR 创建使用已保存的目标和明确的确认操作。推送成功并不等于创建 PR；PR 草稿也是真实的 GitHub 对象。

服务端保存账号、对话、运行事件、连接配置及加密凭据。浏览器本地状态主要用于偏好和草稿，不应保存明文密钥。备份需包含数据库、必要文件和密钥材料，见[运行维护](operations.md)。

详细的执行和 API 契约见[后端架构](../../backend/docs/ARCHITECTURE.md)、[API](../../backend/docs/API.md)和[扩展说明](../full-stack-plugins.md)。
