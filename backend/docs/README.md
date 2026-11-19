# RepoFlow 后端文档

后端由 Gateway、Agent 运行时和可安装扩展组成。产品安装与使用从[项目文档目录](../../docs/README.md)进入。

| 主题 | 参考 |
| --- | --- |
| 结构与 API | [架构](ARCHITECTURE.md)、[API](API.md) |
| 配置与运行 | [配置](CONFIGURATION.md)、[安装](SETUP.md)、[运行事件](RUN_EVENT_STREAM.md) |
| 认证与账号 | [认证设计](AUTH_DESIGN.md)、[SSO](SSO.md)、[账号升级](AUTH_UPGRADE.md) |
| 线程与检查点 | [线程生命周期](THREAD_LIFECYCLE.md)、[检查点保留](checkpoint-retention-contract.md)、[流式输出](STREAMING.md) |
| 扩展开发 | [扩展 Agent 运行](extension-agent-runs.md)、[模型调用](extension-model-invocation.md) |
| 可选能力 | [MCP](MCP_SERVER.md)、[渠道](IM_CHANNEL_CONNECTIONS.md)、[知识](KNOWLEDGE.md)、[文件上传](FILE_UPLOAD.md) |
| 交互与保护 | [运行交互策略](RUN_INTERACTION_POLICY.md)、[保护机制](GUARDRAILS.md)、[循环检测](LOOP_DETECTION.md) |

编辑代码前阅读[后端指导文件](../AGENTS.md)。主题文档说明当前接口与约束；旧任务清单和一次性的变更摘要已清理。
