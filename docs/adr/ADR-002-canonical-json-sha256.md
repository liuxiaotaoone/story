# ADR-002：Canonical JSON V1 + SHA-256

| 项目 | 内容 |
|---|---|
| 状态 | Accepted / Frozen |
| 日期 | 2026-08-11 |
| 适用范围 | Asset、Task、DirectorPlan、Preflight、RenderPlan、缓存与幂等键 |

## 决策

所有持久化内容摘要使用：

```text
Canonical JSON V1 bytes (UTF-8)
→ SHA-256
→ 64 位 lowercase hexadecimal
```

持久化摘要必须使用领域包装：

```json
{
  "canonicalVersion": "canonical-json-v1",
  "domain": "render-plan",
  "payload": {}
}
```

## Canonical JSON V1 规则

1. 对象键按 Unicode code unit 升序排列；禁止依赖 Locale；
2. 数组保持输入顺序；
3. 字符串、布尔值和 null 使用标准 JSON 表达；
4. 数字使用 ECMAScript `JSON.stringify` 的有限数字表达；
5. `-0` 规范为 `0`；
6. 禁止 NaN、Infinity 和负 Infinity；
7. 禁止 `undefined`、Function、Symbol 和 BigInt；
8. 不插入空格或换行；
9. 编码固定为 UTF-8；
10. Hash 算法固定为 SHA-256，输出固定为小写十六进制。

## 领域隔离

`domain` 不得为空，推荐值：

```text
asset
task
director-plan
effective-director-plan
preflight
render-plan
render-state-golden
```

相同 Payload 在不同 Domain 下必须产生不同 Hash。

## 版本变更

任何 Canonical 序列化规则变化必须发布新的 `canonicalVersion`，不得在 `canonical-json-v1` 名称下改变既有输出。旧缓存可以迁移或失效，但不能被新实现静默解释为相同内容。

## 测试向量

```text
Input object: {"b":1,"a":2}
Canonical:    {"a":2,"b":1}
SHA-256:      d3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772
```

实现位于 `packages/schemas/src/hash.ts`，必须以固定测试向量防止行为漂移。
