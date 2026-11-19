# RepoFlow 快速开始

## 准备环境

准备 Python 3.12+、Node.js 22+、pnpm（版本见 `frontend/package.json`）、uv、nginx 和 Git。需要容器沙箱时再准备 Docker；本地模式使用当前服务器的执行环境。

在当前项目根目录运行：

```bash
make config
make install
```

`make config` 根据示例准备配置。已有配置和账号时先备份，不要用示例覆盖正在使用的文件。模型、供应商和运行参数见[配置参考](configuration.md)。`config.yaml`、`.env` 和 `extensions_config.json` 仅用于本地部署，不应提交到仓库。

## 启用仓库协作扩展

维护者可安装项目附带的仓库扩展：

```bash
make extension-install SOURCE=./examples/deerflow-extension-repository-tasks
```

扩展安装器会检查 Python 包并写入 `config.yaml` 的 `plugins`。部署已安装时无需重复安装。启用的代码扩展由维护者控制；重启 Gateway 后才会加载。目录名和 Python 导入路径属于运行接口，请按命令原样使用。

需要精简仓库工作区时，在启动环境中设置 `REPOFLOW_PROFILE=workspace`。完整部署可保留默认配置；此设置影响服务公开的能力，具体见[可选功能](optional-features.md)。

## 开发启动

```bash
make dev
```

默认浏览器入口为 `http://localhost:2026`，由 nginx 汇总前端与 API。不要直接使用前端内部端口作为日常入口。首次使用按页面提示初始化账号，然后登录。

| 服务 | 默认端口 |
| --- | --- |
| 浏览器统一入口 | 2026 |
| Next.js 前端 | 3000 |
| Gateway 与运行时 | 8001 |
| 可选沙箱 Provisioner | 8002 |

## 第一次完成仓库任务

1. 在设置的连接页面绑定自己的 GitHub。可使用 GitHub 授权码流程，或按页面提示保存自己的访问令牌。
2. 点击添加仓库。贡献地址选择自己可写的仓库或 Fork，PR 目标填写希望贡献的官方仓库。
3. 关联仓库，选择模型和模式，告诉 Agent 要修改什么及如何验证。
4. 查看改动与回归结果，再推送贡献分支到自己的 Fork。
5. 填写并保存 PR 信息。只想在应用内保留草稿时使用“保存 PR 信息”。确认要在目标仓库公开创建 PR 后，再选择 GitHub 草稿或正式 PR。

完整说明见[工作区使用](workspace.md)和[仓库协作](repository-tasks.md)。

生产运行使用 `make start`，Docker 部署见[部署参考](deployment.md)。运行日志默认在 `logs/`；诊断和备份见[运行维护](operations.md)。
