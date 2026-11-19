# RBAC 策略参考

本页说明 `RbacAuthorizationProvider` 的当前语义。文件路径供实现中的文档引用使用，不再保存阶段任务清单。[授权接口参考](2026-07-10-pluggable-authorization-rfc.md)说明入口与身份边界。

## 配置与资源名称

角色由 `roles` 映射声明。请求资源与配置键的对应关系在 `rbac.py` 的 `_RESOURCE_POLICY_KEYS` 中维护；例如请求中的 `tool`、`model`、`route` 分别对应配置中的 `tools`、`models`、`routes`。

资源策略只接受 `allow` 与 `deny`。保留的单数请求别名不能冒充配置键，例如插件操作应使用 `plugin_actions`。角色名称、目标名称和列表元素都必须是非空字符串。

## 3.3 策略语义

| 配置或请求 | 当前行为 |
| --- | --- |
| 角色缺失或未知 | 抛出错误，由执行层按错误策略处理 |
| 已知角色未配置该资源策略 | 对该资源不增加 RBAC 限制；已有权限检查继续执行 |
| `allow` 缺省或为 `"*"` | 允许全部候选目标，再应用拒绝列表 |
| `allow: []` | 不允许该资源的任何目标 |
| `allow` 为字符串列表 | 只允许列表中的目标 |
| `deny` 为字符串列表 | 拒绝指定目标，拒绝优先于允许 |
| `deny: null`、`allow: null`、空目标或拼错的策略字段 | 配置或请求校验失败 |
| `filter_resources` | 保留允许候选的顺序，不增加新候选 |

策略在实例构造时编译。`known_roles` 与 `validate_role` 可供管理接口校验角色分配；在配置中声明角色本身不会把角色分配给用户。

源码：`backend/packages/harness/deerflow/authz/rbac.py`。运行时默认角色、Provider 错误策略及管理员边界见[授权接口参考](2026-07-10-pluggable-authorization-rfc.md)。
