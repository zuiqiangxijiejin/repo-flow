# RepoFlow 仓库协作扩展

此扩展提供仓库关联、对话工作区、Git 审阅、账号 GitHub 连接、SSH 主机配置、Fork 推送与 PR 创建。

维护者在项目根目录安装：

```bash
make extension-install SOURCE=./examples/deerflow-extension-repository-tasks
```

安装或升级后重启 Gateway。浏览器资源由清单声明，并在 Gateway 启动时注册；修改静态文件后也需要重启。

用户操作见[仓库协作参考](../../docs/guide/repository-tasks.md)与[工作区指南](../../docs/guide/workspace.md)。扩展使用现有账户权限，不应把个人凭据写入公共配置或代码。
