# 授权接口参考

本页说明当前实现的授权契约。路径保留供源码中的接口说明引用；部署配置以 `config.yaml` 和[安全参考](../guide/security.md)为准。

## 启用与身份

`authorization.enabled` 默认关闭。启用后通过 `authorization.provider.use` 加载授权 Provider，并将其 `config` 作为配置传入。`fail_closed` 默认为 `true`，用于在 Provider 出错或身份无法解析时拒绝访问。

身份来自服务端认证和运行上下文。`default_role` 用于没有绑定角色的上下文，配置的默认角色必须存在。Provider 的策略不会替代已有的账号隔离、资源所有者校验和管理员门槛。

## Provider 接口

协议位于 `backend/packages/harness/deerflow/authz/provider.py`，请求和结果使用 `Principal`、`AuthzRequest`、`AuthzDecision` 与 `AuthzReason`。

- `authorize(request)`：同步单次决策。
- `aauthorize(request)`：异步单次决策。
- `filter_resources(principal, resource_type, candidates)`：从候选集合中筛选可见资源。

筛选结果只能缩小候选集。调用方会与原始候选集合取交集，Provider 不能凭空授予一个不在候选集中的资源。同步筛选方法可能在线程中执行，需要支持并发调用。

## 两层执行

组装 Agent 时先过滤其可见工具和模型等资源；执行时再检查具体请求和动态资源。工具执行阶段复用 guardrail 中间件进行检查。延迟工具目录同样使用已过滤的集合，搜索不能重新引入被拒绝的工具。

Gateway 路由权限、模型使用权限及管理员管理操作继续执行各自的入口检查。可见性、实际授权与配置状态是不同概念。

## 内置 RBAC

内置实现为 `deerflow.authz.rbac:RbacAuthorizationProvider`。角色策略支持工具、路由、模型、技能、沙箱、MCP 服务以及插件操作和管理资源。

[RBAC 策略参考](2026-07-15-authz-phase1a-implementation-plan.md)列出匹配语义。完整配置字段见 [config.example.yaml](../../config.example.yaml)，运行和身份边界见[认证设计](../../backend/docs/AUTH_DESIGN.md)。

## 验证

实现与测试位于 `backend/packages/harness/deerflow/authz/` 和 `backend/tests/`。验证必须同时覆盖组装过滤、执行拒绝、未知角色、Provider 错误和已有所有者检查。
