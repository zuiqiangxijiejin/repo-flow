# RepoFlow

RepoFlow 是面向 GitHub 仓库协作的 AI 工作区。从关联仓库、对话修改和回归验证，到审阅改动、推送自己的 Fork、填写并创建 PR，都可以在同一个应用中完成。

工作区采用浅紫背景和深色导航栏，侧栏收起后保留常用图标。模型、模式、分支和操作说明支持完整显示。

## 文档入口

| 你要做什么 | 文档 |
| --- | --- |
| 第一次安装与启动 | [快速开始](docs/guide/getting-started.md) |
| 使用对话、模型和仓库工具 | [工作区使用指南](docs/guide/workspace.md) |
| 配置自己的 GitHub、Fork 和 PR | [仓库协作与发布](docs/guide/repository-tasks.md) |
| 按需添加工具、技能和插件 | [可选功能](docs/guide/optional-features.md) |
| 查看技术栈、模块和数据流 | [项目架构](docs/guide/architecture.md) |
| 部署、备份、升级和排查 | [运行维护](docs/guide/operations.md) |
| 修改代码与验证 | [贡献指南](CONTRIBUTING.md) |
| 查阅全部主题 | [文档目录](docs/README.md) |

## 本地启动

需要 Python 3.12+、Node.js 22+、pnpm、uv、nginx 和 Git。在项目根目录执行：

```bash
make config
make install
make dev
```

访问 `http://localhost:2026`。先在配置中准备模型，再完成首次账号设置。仓库协作扩展的安装和生产启动方式见[快速开始](docs/guide/getting-started.md)。

## 许可

项目使用 [MIT 许可证](LICENSE)。分发时请一并保留许可证和相关第三方声明。
