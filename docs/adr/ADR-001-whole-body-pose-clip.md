# ADR-001：采用 Whole-body PoseClip，禁止人体骨骼与 IK

| 项目 | 内容 |
|---|---|
| 状态 | Accepted / Frozen |
| 日期 | 2026-08-10 |
| 决策范围 | 人物资产、角色动画、Attachment、运行时职责 |
| 对应基线 | AI 2.5D Pose-Clip Animation Compiler 技术设计文档 V1 |

## 背景

项目使用 AI 生成的人物和动物素材，而不是由专业 Live2D、Spine 或传统动画美术按照严格拆件规范制作的标准部件。

如果将完整人物拆成身体、上臂、前臂、手、大腿和小腿，并在运行时建立父子旋转链，将引入以下高概率问题：

- 关节裂缝与服装断层；
- AI 不同姿态中的肢体长度和比例不一致；
- Pivot 与 Anchor 漂移；
- 手臂穿过身体；
- 简单 IK 放大素材误差；
- 对生成资产规范和自动 QA 提出过高要求；
- Renderer 被迫承担人体结构修复职责。

项目的核心竞争力不是建设通用人体动画软件，而是在受限能力范围内稳定生成 2.5D 漫剧。因此需要主动缩小运行时角色动画能力。

## 决策

人物和动物动画采用：

```text
Whole-body Sprite
+ Multi-frame PoseClip
+ Whole-entity Transform
+ Foot Anchor Compensation
+ Deterministic Micro Motion
+ Camera / Parallax / Occlusion / Shadow
```

禁止：

```text
人体骨骼
人体部件拆分链
人体父子关节旋转
IK / FK
人体 Retargeting
运行时人体结构变形与修复
```

## 强制约束

### 1. PoseClip

- PoseClip 的每一帧都是完整人物或完整动物图片；
- 每帧具有独立 Foot、Center 及可选 Hand/Head Anchor；
- 每帧具有确定的持续帧数和脚部接触状态；
- PoseClip 只描述动作外观，不产生 Root Motion；
- Entity 世界位移只能由 Timeline Track 决定；
- PoseClip 播放速度可以调整，但必须处于 Capability Catalog 允许范围内；
- PoseClip 必须声明 `always`、`contact-only` 或 `none` Ground Lock 策略；
- 每帧可以声明 Reference Foot，接触脚修正只能平移完整 Sprite。

### 2. Anchor Compensation

Timeline 中地面角色的位置表示世界脚点。Frame Evaluator 使用当前完整 Sprite 的 Foot Anchor 反推渲染位置，使每张 Pose 图的脚点对齐到同一 Ground Projection 结果；Renderer Adapter 只应用已经求得的最终 Transform。

Anchor Compensation 只是完整图片坐标补偿，不构成骨骼、关节或人体变形。

Ground Lock 修正必须具有最大像素限制。超过限制表示素材、Anchor 或 Timeline 不一致，系统应报告 QA 错误，不得继续拉伸、旋转或变形人体。

### 3. Pose Transition

MVP 只允许：

```text
cut
2～4 Frame 的短 crossfade
hold-then-cut
```

禁止 Pose Morph。Transition 使用 Foot 或 Center Anchor 对齐两张完整 Sprite。Crossfade 期间的两张图片属于同一逻辑 Entity 和同一 Transition，不改变 Ownership。

`hold-then-cut` 的有效切换帧是 `startFrame + durationFrames`；`cut` 和 `crossfade` 的有效切换帧是 `startFrame`。对应 PoseEvent 必须发生在有效切换帧，Evaluator 不得自行猜测。

### 4. Auxiliary Parts

只允许不构成人体关节链的单层辅助部件，例如：

```text
眼睛
嘴型
帽子
披风
武器
灯笼
手持道具
```

允许：

```text
人物 → 灯笼
人物 → 武器
```

禁止：

```text
身体 → 上臂 → 前臂 → 手 → 武器
```

### 5. Ownership 与 Attachment

- Entity 在任意 Frame 只能有一个 Owner；
- Owner 只能是 World 或另一个 Entity 的单层 Slot；
- 禁止 Attachment 环和多层 Entity 链；
- Attach/Detach 必须发生在确定 Event Frame；
- Attachment 不自然时应重新生成 Pose 或资产，不使用 IK 修复；
- `socket` 模式独立渲染被挂载 Entity；
- `socket` 模式必须同时声明 Owner Slot 对应的 Pose Anchor 与 Child Asset Attachment Anchor，例如 `lantern.grip → farmer.rightHand`；
- Socket 对齐只允许完整子资产的平移及显式允许的整体旋转/整体缩放；
- `baked` 模式使用包含交互对象的完整复合 Pose，并停止独立渲染被包含 Entity；
- Ownership 状态必须能够根据 RenderPlan 和目标 Frame 独立计算。

### 6. 复杂接触动作

抱兔子、拥抱、背人等高接触动作优先生成完整复合 Pose，不进行人体运行时拼装。

如果某项复杂动作无法通过已审核的完整 Pose 或简单单层 Attachment 表达，则该动作属于 `UNSUPPORTED_CAPABILITY`，必须 Rewrite、Fallback 或拒绝编译。

### 7. Renderer 职责

Renderer 可以：

```text
选择完整 PoseClip Frame
应用完整 Entity Transform
定位单层辅助部件和 Attachment
应用确定性微动作
执行 Camera、Parallax、Mask、Filter 和渲染
```

Renderer 不可以：

```text
推断人体关节
修复人物姿态
生成缺失肢体
让手臂通过 IK 追赶目标
根据故事语义临时发明动作
```

## 结果

### 正面结果

- 消除运行时关节裂缝和肢体错位这一类结构性风险；
- 降低 AI 资产规范和自动 QA 的复杂度；
- Preview 与 Final 更容易保持确定性；
- 动画问题可以定位为资产、Track、Anchor 或 Event 问题；
- 更符合动态漫画和 2.5D 漫剧的产品定位；
- 便于按 PoseClip 和 Shot 局部重新生成。

### 代价与限制

- 动作库必须提前准备完整 PoseClip；
- 任意动作组合能力弱于通用骨骼系统；
- Pose 之间可能需要更多 AI 生成和人工审核；
- 高接触动作往往需要专门的完整复合 Pose；
- 角色换装可能需要重新生成一组完整 PoseClip；
- 系统不会支持自由战斗、舞蹈等高自由度动作。

这些限制属于主动接受的产品边界，不应由 Renderer 以隐式复杂度弥补。

## 被否决的方案

### 人体混合纸偶

```text
头 / 身体 / 上臂 / 前臂 / 手 / 大腿 / 小腿
+ Pivot
+ 简单 IK
```

否决原因：本质仍然是人体关节系统，与 AI 生成素材的不稳定性冲突。

### 纯单张 Pose 切换

只使用 `walk.png`、`run.png` 等单图也不足以满足视觉目标。走路、跑步等连续动作仍应使用多帧完整人物 PoseClip，并通过 Foot Anchor Compensation 降低跳位和脚滑。

## 合规检查

代码评审和设计评审必须检查：

```text
[ ] 人物 Sprite 是否始终为完整人物图
[ ] 是否出现人体父子 Transform 链
[ ] 是否引入 IK/FK 或人体 Retargeting
[ ] PoseClip 是否保持 rootMotion.mode = timeline
[ ] Foot Anchor 是否按每个 Frame 独立读取
[ ] Ground Lock 是否只平移完整 Sprite 且受最大修正量限制
[ ] Pose Transition 是否未引入 Morph 或人体变形
[ ] Attachment 是否只有单层
[ ] Entity 是否保持单一 Ownership
[ ] 复杂交互是否使用完整复合 Pose 或明确拒绝
[ ] Renderer 是否仍是语义无关的执行层
[ ] Foot/Ground Lock 是否由 Frame Evaluator 求值而非 Renderer 推理
```

## 变更流程

本 ADR 状态为 Frozen。任何引入人体骨骼、人体拆件链、IK 或运行时人体变形的提案，必须：

1. 新建替代 ADR；
2. 提供与 Whole-body PoseClip 的独立对照实验；
3. 使用真实 AI 资产，不得只用专业拆件设计稿；
4. 量化关节错误率、资产成功率、QA 成本和视觉收益；
5. 获得项目架构负责人明确批准；
6. 在批准前不得向主分支引入相关基础设施。
