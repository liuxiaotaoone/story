# M3 Commit 3.2.2 — Trusted Production Admission

状态：**PASS / Frozen**

本提交只补 Production Profile 的外部信任根，不增加 QA 指标，不修改 Generation、Processor、Continuity 数学或 Cache Identity。

## Trust Gate

Profile 自身的 `approval` 与 `profileHash` 只证明内容完整，不能证明生产系统信任它。最终晋级现在额外要求部署或 Release Manifest 提供：

```text
ProductionAdmission.expectedProfileHash
```

`assertPoseClipProductionResultIntegrity()` 对 `productionReady=true` 强制执行：

```text
Profile approval = approved
+ Profile Hash integrity PASS
+ Profile Hash = externally trusted expectedProfileHash
→ Production admission PASS
```

缺少 Admission 时抛出 `PRODUCTION_PROFILE_ADMISSION_MISSING`；Hash 不匹配时抛出 `PRODUCTION_PROFILE_NOT_TRUSTED`。因此调用代码不能只创建一个 `approval=approved` 的新 Profile 就让结果晋级。

`assemblePoseClipProductionResult()` 同样要求显式 `trustedProfileHash`，并在组装前拒绝不匹配 Profile。E2E 使用固定的 trust-root Hash 常量，不从本次生成的 Profile 动态回填。

## Revocation

撤销由外部 allowlist / deployment manifest 更新 `expectedProfileHash` 实现。旧 Result 内嵌的 `approval=approved` Profile 即使 Hash 完整，只要不再匹配当前 trusted hash，就会被 `PRODUCTION_PROFILE_NOT_TRUSTED` 拒绝。

长期可再拆分稳定 Production Policy 与单次 Run Manifest；该结构留给 M4 以后，本提交不继续扩展 M3 合同。

## Verification

回归测试覆盖：

- `/prompt` ambiguous submit 仍只提交一次；
- self-approved Profile 缺少 Admission 时拒绝；
- trusted hash 不匹配时拒绝；
- revoked Profile 即使自身 Hash 正确也不能晋级；
- 固定 trust root 下四帧 Executor → Continuity → Assembly → Integrity E2E 通过。

M3 到此冻结，下一阶段进入 M4 Real AI PoseClip Pipeline。
