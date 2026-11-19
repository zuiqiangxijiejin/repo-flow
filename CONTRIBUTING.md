# 为 RepoFlow 贡献代码

从[快速开始](docs/guide/getting-started.md)准备环境。编辑前阅读根目录及目标目录的 `AGENTS.md`，界面规则见 [frontend/DESIGN.md](frontend/DESIGN.md)。

## 开发流程

1. 为任务创建分支，检查已有的未提交改动。
2. 修改功能时同步更新对应的测试和主题文档。
3. 在本地运行与改动相关的检查，再提交可以独立审阅的改动。
4. 推送自己的贡献分支，填写 PR 的问题、行为变化与验证结果。

仓库业务功能优先通过可安装扩展实现。认证、Agent 循环、上下文和通用运行能力的修复位于核心；现有扩展契约不能表达时再添加通用接口。

## 检查命令

```bash
cd frontend
pnpm format
pnpm check
pnpm test
pnpm test:e2e
```

主机上的 pnpm 也可从根目录运行 `python3 scripts/pnpm.py <参数>`。浏览器测试使用模拟 API，真实后端测试单独启用。

```bash
cd backend
make test
make test-blocking-io
make lint
```

默认后端测试保持离线，不调用真实外部 API。需要验证实际供应商时，在独立测试环境准备凭据，再从 `backend/` 运行 `make test-live`；该目标显式设置 `DEER_FLOW_RUN_LIVE_TESTS=1`。不要把真实 API 测试或个人凭据加入默认 CI。

根目录运行 `make check-agent-guidance` 检查目录指导文件。更细的命令和边界见各目录的指导文件。

## 数据和配置

不要提交 `config.yaml`、`.env`、`extensions_config.json`、运行数据库、账号数据、密钥或真实仓库克隆。测试使用独立夹具；修改页面不能触发真实 Fork 推送或 PR 创建。

版本字段应保持一致，使用 `scripts/bump_version.sh <版本>` 和 `scripts/verify_versions.sh <版本>` 管理。发布流程见 [RELEASING.md](RELEASING.md)。

安装第三方扩展或组件时保留必要许可证和声明。项目反馈入口为当前仓库的 Issues；安全问题见 [SECURITY.md](SECURITY.md)。
