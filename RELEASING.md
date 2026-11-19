# RepoFlow 发布维护

## 版本

以下字段保持一致：

- `backend/pyproject.toml` 的 `version`
- `backend/packages/harness/pyproject.toml` 的 `version`
- `frontend/package.json` 的 `version`
- `deploy/helm/deer-flow/Chart.yaml` 的 `version` 和 `appVersion`

`scripts/bump_version.sh <版本>` 更新版本及锁文件；`scripts/verify_versions.sh <版本>` 校验一致性。前端展示版本从构建配置或包版本读取。

## 准备发布

1. 确认版本、相关单元测试、浏览器测试和文档。
2. 备份配置、数据库、用户文件及凭据加密材料。
3. 构建完整前端产物；代码扩展变更同步校验包与静态清单。
4. 发布到新的产物目录，切换服务并检查就绪状态和原有数据。
5. 保留上一份可运行产物，在验证后再按部署策略清理旧版本。

具体启动、备份与故障恢复见[运行维护](docs/guide/operations.md)。

## 自动发布

仓库保留了容器、包与 Helm 的发布工作流。它们的仓库条件、镜像地址、注册表权限和发布秘密需要维护者按自己的发布环境配置。推送标签前检查这些条件；标签存在不代表镜像或包已经发布。

版本标签采用 `vX.Y.Z`，应与待发布版本一致。公开发布或推送标签前完成代码审阅。
