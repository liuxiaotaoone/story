# AI 2.5D Pose-Clip Animation Compiler 技术设计文档 V1

> 基于完整人物 Pose Clip、受限动作语法、确定性 Timeline Compiler 和 AI 资产生产线的 2.5D 漫剧生成系统

| 项目 | 内容 |
|---|---|
| 文档状态 | Frozen Architecture Baseline / V1.0 |
| 决策状态 | 冻结；变更必须新增或修订 ADR |
| 日期 | 2026-08-10 |
| 首个目标版本 | 30～60 秒、720P、30FPS 的受限领域 MVP |

---

## 1. 文档目的

本文档是新项目的正式技术架构基线，用于指导项目初始化、模块划分、数据模型设计、编码顺序和验收。

本文档重点回答：

1. 系统做什么、不做什么；
2. AI、Compiler、Timeline、Evaluator 和 Renderer 的边界；
3. Whole-body PoseClip 如何表达、播放和进行 Foot Anchor Compensation；
4. Entity Ownership、Attachment 和复合 Pose 如何避免重复实体；
5. DirectorPlan、RenderPlan、Timeline、RenderState 等核心 Schema；
6. AI 资产、任务依赖、缓存、QA 和人工审核如何接入；
7. M0～M6 每个里程碑的交付物和退出条件。

本文档不追求建设通用动画软件。系统定位是：

> **能力受限但稳定、可验证、可重复生成的 AI 2.5D 漫剧编译器。**

---

## 2. 产品目标与 MVP 边界

### 2.1 产品目标

输入受限领域短故事，经 AI 生成导演计划与视觉素材，再由确定性程序完成：

```text
故事理解
→ 受限导演计划
→ 能力检查与编译
→ 资产解析
→ 唯一 Timeline
→ 逐帧状态求值
→ PixiJS 渲染
→ 音频、字幕与视频合成
→ QA 与人工审核
→ MP4
```

### 2.2 MVP 冻结范围

| 维度 | MVP 限制 |
|---|---|
| 时长 | 30～60 秒 |
| 分辨率 | 1280 × 720 |
| 帧率 | 30 FPS |
| 画风 | 1 种固定画风 |
| Environment | 最多 2 个 |
| Character | 最多 3 个 |
| 标准动作 | 8～12 种 |
| Camera Template | 约 6 种 |
| 动画形式 | Whole-body PoseClip |
| 音频 | Narration、Subtitle、简单 SFX |
| 内容领域 | 寓言、儿童短故事等受限领域 |

### 2.3 MVP 支持的故事语法

第一版优先支持：

```text
enter
exit
walk
run
observe
wait
sit
bend
pickup
hold
animal_run
collision
reaction
```

第一版明确不支持：

```text
战斗
骑乘
舞蹈
游泳
攀爬
复杂拥抱
背人
多人肢体互动
复杂手部操作
复杂物理互动
```

遇到不支持的能力，Compiler 必须返回 `UNSUPPORTED_CAPABILITY`，然后执行 Rewrite、Fallback 或人工处理；Renderer 不得尝试猜测或补救。

---

## 3. ADR-001：Whole-body Pose-Clip 架构决策

本章节是架构基线摘要；独立决策记录见 `docs/adr/ADR-001-whole-body-pose-clip.md`。

### 3.1 决策

人物资产只允许完整人物 Sprite 和少量非人体辅助部件。禁止人体骨骼、人体部件链、IK、人体重定向和运行时人体变形。

### 3.2 强制原则

#### 人物资产原则

允许：

```text
完整人物 Pose Sprite
完整人物多帧 PoseClip
整个人物 Transform
轻微 Bob / Swing / Breathing / Shake / Squash / Stretch
独立眼睛、嘴型、帽子、披风、武器、灯笼等非人体辅助部件
```

禁止：

```text
人体 Skeleton
身体 → 上臂 → 前臂 → 手等人体父子链
人体部件运行时旋转拼装
正向/反向运动学
人体 Retargeting
运行时人体变形修复
```

#### PoseClip 原则

- `walk_01 → walk_02 → walk_03` 表示“人物走路时的外观变化”，不表示人物走了多远；
- 人物在世界中的位置始终由 `entityTrack.position(frame)` 决定；
- PoseClip 不产生 Root Motion；
- 每个完整人物帧拥有独立 Anchor、持续帧数和脚部接触状态；
- 引擎必须通过 Anchor Compensation 将当前 Foot Anchor 对齐到世界地面点。

#### Attachment 原则

- 只允许单层挂载；
- Entity 在任意 Frame 同时只能有一个 Owner；
- `attach` / `detach` 必须发生在确定 Event Frame；
- Attachment 不得形成环，也不得形成多层实体链；
- 不允许使用 IK 让人体追赶道具；
- Attachment 不自然时，重新生成 Pose/资产，不在 Renderer 中修复人体。

#### 复杂交互原则

高接触动作优先使用完整复合 Pose，例如：

```text
farmer_hold_rabbit
mother_hug_child
person_carry_bag
```

复合 Pose 中被包含的 Entity 仍保留逻辑身份和 Ownership，但可以通过 `baked` 模式不再独立渲染。

#### 时间原则

Timeline 从 M0 开始就是唯一时间源。Preview、Final、Camera、Pose、Attachment、Visibility、Narration、Subtitle、SFX 和 Transition 最终都从同一个帧时间模型派生。

#### AI 原则

Gemini 只生成 DirectorPlan，不直接生成最终 Timeline、像素坐标、精确帧号或 RenderState。

#### Compiler 原则

编译方向固定为：

```text
DirectorPlan → RenderPlan → RenderState
```

其中 Timeline 是 RenderPlan 内部唯一的时间子模型。Render 阶段不得反向推断故事意图。

#### 能力原则

所有 Action、Pose、Attachment、Camera、Environment 能力必须先注册到 Capability Catalog。未注册能力不得进入 RenderPlan。

#### 渲染原则

- React 管理 UI、Inspector、任务和审核；
- Paper Engine 负责纯 TypeScript 数据计算；
- PixiJS 命令式更新场景对象；
- 禁止逐帧高频状态通过 React reconciliation 驱动 Pixi 场景。

#### QA 原则

QA 从 M0 开始伴随 Schema、Compiler、Evaluator、Asset 和 Renderer 生长；M6 负责平台化，而不是第一次增加 QA。

### 3.3 决策理由

AI 生成的人物素材不具备专业 Live2D/Spine 拆件规范。人体层级会放大关节裂缝、长度不一致、Pivot 漂移、穿插和服装断层等问题。Whole-body PoseClip 将问题约束为完整图片的一致性、定位和时序问题，更适合自动生成与自动质检。

### 3.4 变更规则

任何试图引入人体骨骼、人体拆件或 IK 的变更，必须：

1. 新建 ADR；
2. 提供独立技术实验；
3. 证明 AI 资产规范、视觉收益、失败率和 QA 成本优于 Whole-body PoseClip；
4. 不得直接修改 ADR-001 的语义。

---

## 4. 系统总体架构

```text
┌──────────────────────────────┐
│ Story / Human Input          │
└──────────────┬───────────────┘
               ↓
┌──────────────────────────────┐
│ AI Director                  │
│ 输出 DirectorPlan            │
└──────────────┬───────────────┘
               ↓ Human Override
┌──────────────────────────────┐
│ Effective DirectorPlan       │
└──────────────┬───────────────┘
               ↓
┌──────────────────────────────┐
│ Preflight Compiler           │
│ Schema / Capability / Action │
└──────────────┬───────────────┘
               ↓
┌──────────────────────────────┐
│ TTS → Audio Measurement      │
└──────────────┬───────────────┘
               ↓
┌──────────────────────────────┐
│ Final Compiler               │
│ Duration / Spatial / Timeline│
└──────────────┬───────────────┘
               ↓
┌──────────────────────────────┐
│ RenderPlan                   │
│ 含 Canonical Timeline        │
└──────────────┬───────────────┘
               ↓ evaluate(frame)
┌──────────────────────────────┐
│ RenderState                  │
└───────┬──────────┬───────────┘
        ↓          ↓
  Pixi Adapter   QA Adapter
        ↓
 Preview / Frame Export
        ↓
 Audio + Subtitle + FFmpeg
        ↓
 MP4
```

### 4.1 三层数据边界

| 层 | 作用 | 允许出现 | 禁止出现 |
|---|---|---|---|
| DirectorPlan | 描述故事如何演 | 语义动作、Blocking、镜头意图 | 像素、精确帧、纹理对象 |
| RenderPlan | 编译后的不可变执行计划 | 资产 ID、实体、轨道、帧、坐标、Timeline | LLM 模糊语义、Renderer 对象 |
| RenderState | 某一帧的最终渲染状态 | Sprite、Camera、Subtitle、Effects | 跨帧可变状态、故事推理 |

### 4.2 RenderPlan 与 Timeline 的关系

RenderPlan 是一次编译的完整不可变产物；Timeline 是 RenderPlan 中唯一描述时间的子对象。以下为关系示意，正式定义见 10.1：

```ts
interface RenderPlanOutline {
  schemaVersion: string;
  project: ProjectSpec;
  assets: AssetManifest;
  environments: EnvironmentDefinition[];
  entities: EntityDefinition[];
  timeline: Timeline;
  provenance: CompileProvenance;
}
```

系统中不得存在第二份独立的 Shot 时间、音频时间或动画时间。

---

## 5. 推荐代码目录

```text
apps/
  studio/                         React 审核、时间轴和 Preview UI
  render-worker/                  离线渲染 Worker

packages/
  schemas/                        Zod Schema、TypeScript 类型、JSON Schema
  capability-catalog/             动作、Pose、Camera、环境能力
  director-contracts/             DirectorPlan 契约与 Rewrite 错误
  director-overrides/             Override 应用、冲突与审计
  timeline-compiler/              DirectorPlan → RenderPlan
  duration-solver/                镜头时长约束求解
  spatial-engine/                 Blocking、地面投影、Camera Planner
  paper-engine/                   Timeline、Track、Evaluator、Ownership
  paper-pixi/                     RenderState → PixiJS
  render-export/                  Frame Export / FFmpeg / 可选 Remotion
  qa-engine/                      Schema、Timeline、Composition、Final QA
  task-graph/                     TaskNode、Hash、失效传播、恢复

services/
  orchestrator/                   SQLite + Filesystem 编排服务
  asset-worker/                   Python / ComfyUI / Flux
  audio-worker/                   Python / Qwen3-TTS / FFprobe

experiments/
  renderer-feasibility/           Preview 与 Final 技术验证
  asset-feasibility/              AI Identity、Pose、分层、抠图实验

assets/
  references/                     风格与角色参考
  generated/                      内容寻址生成资产
  manual/                         人工 Demo 资产

projects/
  story-demo/                     项目数据与 RenderPlan
```

### 5.1 依赖方向

```text
schemas
  ↑
paper-engine ← timeline-compiler ← director-contracts
  ↑                 ↑
paper-pixi      spatial-engine / duration-solver

render-export → paper-pixi + paper-engine
studio        → paper-pixi + paper-engine
qa-engine     → schemas + paper-engine
```

强制约束：

- `paper-engine` 不依赖 React、PixiJS、FFmpeg、Gemini、ComfyUI；
- `paper-pixi` 不包含故事和动作规划逻辑；
- `studio` 不实现第二套 Timeline 求值器；
- Python Worker 不实现 Timeline 插值和 Frame Evaluator。

---

## 6. Schema 与版本策略

### 6.1 基础类型

```ts
type Id = string;
type Frame = number;       // 非负整数
type Unit = number;        // 归一化单位，通常为 0..1
type Degrees = number;

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

interface FrameRange {
  startFrame: Frame;       // inclusive
  endFrame: Frame;         // exclusive
}

interface Transform2D {
  position: Point;
  scale: Point;
  rotation: number;        // radians
  opacity: number;         // 0..1
}
```

### 6.2 版本规则

- Schema 使用语义化版本字符串，如 `1.0.0`；
- 数据文件必须带 `schemaVersion`；
- V1 Reader 的 `schemaVersion` 必须使用 literal `"1.0.0"`，不得用任意 SemVer 接受未来 V2 数据；
- 修改已有字段语义必须提升 Major；
- 新增可选字段提升 Minor；
- 修正文档或约束但不改变数据提升 Patch；
- 必须提供显式迁移函数，例如 `migrateTimelineV1ToV2()`；
- 禁止 Reader 根据字段猜测版本。

### 6.3 运行时验证

TypeScript interface 只提供编译期类型。所有外部 JSON、AI 输出和持久化数据必须通过运行时 Schema 校验。推荐：

```text
Zod 作为 TypeScript 运行时 Schema
↓
生成 JSON Schema
↓
用于 Gemini Structured Output 与跨语言 Worker 契约
```

---

## 7. 核心领域模型

### 7.1 ProjectSpec

```ts
interface ProjectSpec {
  id: Id;
  title: string;
  fps: 30;
  resolution: Size;
  sampleRate: 48000;
  seed: number;
  styleGuideId: Id;
  capabilityCatalogVersion: string;
}
```

时间一律以整数 Frame 表达。秒数仅用于 UI：

```ts
const seconds = frame / fps;
```

音频内部以 Sample 为准，编译时建立 Frame 与 Sample 的确定性映射，禁止累计浮点增量。

### 7.2 Asset

```ts
type VisualAssetKind =
  | "character-frame"
  | "animal-frame"
  | "prop"
  | "environment-layer"
  | "effect";

type NonVisualAssetKind = "audio" | "font";
type AssetKind = VisualAssetKind | NonVisualAssetKind;

interface AssetRecordBase {
  id: Id;
  uri: string;
  contentHash: string;
  source: "manual" | "generated";
  provenance?: AssetProvenance;
  qaStatus: "pending" | "passed" | "warning" | "failed";
}

interface VisualAssetRecord extends AssetRecordBase {
  kind: VisualAssetKind;
  width: number;
  height: number;
  alphaMode: "straight" | "premultiplied" | "opaque";
  attachmentAnchors?: AttachmentAnchor[];
}

interface NonVisualAssetRecord extends AssetRecordBase {
  kind: NonVisualAssetKind;
}

type AssetRecord = VisualAssetRecord | NonVisualAssetRecord;

interface ProducerRef {
  name: string;
  version: string;
}

interface AssetProvenance {
  inputHash: string;
  promptHash?: string;
  modelId?: string;
  modelVersion?: string;
  workflowVersion?: string;
  seed?: number;
  producer: ProducerRef;
  createdAt: string;
}

interface AssetManifest {
  schemaVersion: string;
  assets: AssetRecord[];
}
```

视觉资产必须提供正整数 `width/height`，因为 Frame Evaluator 不允许异步加载图片后再补尺寸。`source = "generated"` 的任何 AI/TTS 资产必须携带完整 `provenance`；人工资产可以省略。

### 7.3 PoseClip

```ts
type Direction = "left" | "right" | "front";
type FootContact = "left-foot" | "right-foot" | "both" | "none";
type ReferenceFoot = "left-foot" | "right-foot" | "midpoint" | "auto";
type GroundLockMode = "always" | "contact-only" | "none";

interface PoseAnchors {
  foot: Point;
  leftFoot?: Point;
  rightFoot?: Point;
  center: Point;
  leftHand?: Point;
  rightHand?: Point;
  head?: Point;
  auxiliary?: Record<string, Point>;
}

interface PoseClipFrame {
  assetId: Id;
  durationFrames: number;
  anchors: PoseAnchors;
  contact?: {
    type: FootContact;
  };
  referenceFoot?: ReferenceFoot;
}

interface PoseClip {
  id: Id;
  entityType: string;
  action: string;
  loop: boolean;
  direction: Direction;
  frames: PoseClipFrame[];
  rootMotion: {
    mode: "timeline";
  };
  groundLock: {
    mode: GroundLockMode;
    maxCorrectionPx: number;
  };
  tags?: string[];
  compositeMembers?: Id[];
}
```

约束：

- `durationFrames >= 1`；
- 所有 Anchor 坐标相对图片归一化到 `0..1`；
- `foot` 和 `center` 必填；
- `foot` 是完整 Sprite 的标准落地点；`leftFoot`、`rightFoot` 用于接触脚锁定；
- `referenceFoot: "auto"` 根据 `contact.type` 选择左脚、右脚或双脚中点；
- `groundLock.mode = "always"` 未指定 `referenceFoot` 时使用必填的 `foot`；
- `groundLock.mode = "contact-only"` 时，左脚/右脚接触帧必须提供相应的 `leftFoot`/`rightFoot`，双脚接触必须可计算双脚中点；缺失即 Asset Schema/QA 失败；
- `contact-only` 遇到 `contact.type = "none"` 时不施加额外 Ground Lock Correction；
- `maxCorrectionPx` 按 Environment 的 `referenceResolution` 计量，输出到其他分辨率时等比缩放；
- 同一个 Clip 的画布、比例和视觉方向必须通过 Asset QA；
- `compositeMembers` 只描述视觉上已烘焙进完整 Pose 的逻辑实体，不创建人体层级。

推荐策略：

```text
idle / wait / bend     → always
walk / run             → contact-only
未来 jump / fall       → none
```

Ground Lock 是完整 Sprite 的平移修正，不允许旋转、缩放或变形人体。修正量超过 `maxCorrectionPx` 时不得继续强行校正，应产生 Asset/Animation QA 错误。

### 7.4 EntityDefinition 与 EntityInstance

定义与实例必须分离：

```ts
interface EntityDefinition {
  id: Id;
  entityType: string;
  displayName: string;
  poseClipIds: Id[];
  defaultPoseClipId: Id;
  attachmentSlots: AttachmentSlotDefinition[];
  tags?: string[];
}

interface EntityInstance {
  id: Id;
  definitionId: Id;
  sceneId: Id;
  activeRange: FrameRange;
  initialOwner: OwnerRef;
}
```

同一个角色可在不同 Shot 中复用 EntityDefinition，但每个逻辑角色在同一时间只能对应一个 EntityInstance。

### 7.5 Ownership 与 Attachment

```ts
type OwnerRef =
  | { kind: "world"; environmentId: Id }
  | { kind: "entity"; entityId: Id; slot: string };

type AttachmentMode = "socket" | "baked";

interface AttachmentAnchor {
  id: string;       // 例如 prop 的 "grip"
  point: Point;     // 相对资产图片归一化到 0..1
}

interface AttachmentSlotDefinition {
  id: string;       // 例如 "rightHand"
  ownerAnchor: "leftHand" | "rightHand" | string;
}

interface SocketBinding {
  attachmentAnchorId: string;
  inheritRotation: boolean;
  inheritScale: boolean;
  rotationOffset?: number;
  scaleMultiplier?: number;
}

interface OwnershipEvent {
  id: Id;
  frame: Frame;
  type: "attach" | "detach";
  entityId: Id;
  from: OwnerRef;
  to: OwnerRef;
  mode: AttachmentMode;
  preserveWorldTransform: boolean;
  socketBinding?: SocketBinding;
}
```

语义：

- `socket`：被挂载 Entity 仍独立渲染，通过 Owner Pose 的 Anchor 定位；
- `baked`：被挂载 Entity 已烘焙到 Owner 的完整复合 Pose 中，被挂载 Entity 不再独立渲染；
- `detach` 后 Ownership 返回 World，并恢复独立渲染；
- 所有 Ownership 状态由“目标 Frame 之前最后一个有效 OwnershipEvent”直接计算，不依赖上一帧可变状态。

Socket Attachment 的两端必须同时声明：

```text
Owner EntityDefinition.attachmentSlots
  rightHand → owner Pose 的 rightHand Anchor

Child VisualAssetRecord.attachmentAnchors
  grip → 道具自身的 grip Anchor
```

求值约束为：

```text
world(ownerSlot.ownerAnchor) = world(childAsset.attachmentAnchor)
```

Evaluator 通过完整道具的平移，以及配置允许的整体旋转/整体缩放完成对齐，不进行人体骨骼或局部变形。例如 `lantern.grip → farmer.rightHand`。

编译期约束：

```text
一个 Entity 一个 Frame 只有一个 Owner
禁止 Ownership 环
禁止 Entity → Entity → Entity 多层链
from 必须与事件前 Ownership 一致
baked 模式必须存在对应 compositeMembers 声明
attach + socket 模式必须具有 socketBinding，且 Owner Slot 和 Child Attachment Anchor 都存在
detach 和 baked 模式不得携带 socketBinding
Attachment 跳变超过阈值时 QA 失败
```

### 7.6 Environment

Environment 是可复用的分层场景包：

```ts
type RenderLayerName =
  | "far"
  | "mid"
  | "ground"
  | "characters"
  | "foreground"
  | "effects"
  | "overlay";

const RENDER_LAYER_ORDER: Record<RenderLayerName, number> = {
  far: 0,
  mid: 100,
  ground: 200,
  characters: 300,
  foreground: 400,
  effects: 500,
  overlay: 600,
};

interface EnvironmentLayer {
  id: Id;
  assetId: Id;
  renderLayer: RenderLayerName;
  zIndex: number;
  parallaxFactor: number;
  transform: Transform2D;
}

interface GroundSurface {
  farLeft: Point;
  farRight: Point;
  nearLeft: Point;
  nearRight: Point;
  farScale: number;
  nearScale: number;
  depthEasing: "linear" | "ease-in" | "ease-out" | "ease-in-out";
  walkableZones: Polygon[];
}

interface Polygon {
  points: Point[];
}

interface EnvironmentDefinition {
  id: Id;
  name: string;
  referenceResolution: Size;
  layers: EnvironmentLayer[];
  ground: GroundSurface;
  occlusionZones: Polygon[];
  safeSubtitleZone?: Polygon;
}
```

地面位置使用 `GroundPoint` 表示：

```ts
interface GroundPoint {
  u: number;  // 水平方向 0..1
  v: number;  // 远到近 0..1
}

interface GroundProjectionResult {
  worldFootPosition: Point;
  perspectiveScale: number;
  depth: number;
}
```

`SpatialEngine.projectGround(environment, groundPoint)` 将 `(u,v)` 投影为世界脚点、透视比例和深度。`renderLayer`、`zIndex`、`depth`、`parallaxFactor` 必须分开，禁止使用单一 `depth` 同时承担所有语义。

MVP 只实现四边形 Ground Surface 与双线性插值：

```ts
const farPoint = lerpPoint(ground.farLeft, ground.farRight, u);
const nearPoint = lerpPoint(ground.nearLeft, ground.nearRight, u);
const t = applyDepthEasing(v, ground.depthEasing);

const worldFootPosition = lerpPoint(farPoint, nearPoint, t);
const perspectiveScale = lerp(ground.farScale, ground.nearScale, t);
const depth = v;
```

MVP 不实现深度图、Mesh Ground、复杂透视地形或任意曲面。M0 只验证简单四边形投影是否足够；没有明确失败证据不得扩展地面模型。

### 7.7 Camera

```ts
interface CameraState {
  position: Point;
  zoom: number;
  rotation: number;
}

type CameraIntent =
  | "static"
  | "slow-push-in"
  | "slow-pull-out"
  | "pan-left"
  | "pan-right"
  | "follow";
```

Gemini 只允许输出 CameraIntent。Camera Planner 将 Intent 转换为 Camera Track。

---

## 8. DirectorPlan

DirectorPlan 属于 AI 语义世界，不包含精确渲染数值。

```ts
interface DirectorPlan {
  schemaVersion: string;
  projectId: Id;
  storyBible: StoryBible;
  scenes: DirectorScene[];
  assetRequirements: AssetRequirement[];
}

interface StoryBible {
  title: string;
  summary: string;
  styleGuideId: Id;
  characters: Array<{
    id: Id;
    description: string;
    traits: string[];
  }>;
}

interface DirectorScene {
  id: Id;
  environmentIntent: string;
  shots: DirectorShot[];
}

interface DirectorShot {
  id: Id;
  shotType: "wide" | "medium" | "close-up";
  focusEntityId: Id;
  cameraIntent: CameraIntent;
  blocking: Record<Id, BlockingIntent>;
  actions: DirectorAction[];
  narration?: string;
}

type HorizontalIntent = "far-left" | "left" | "center" | "right" | "far-right";
type DepthIntent = "background" | "midground" | "ground" | "foreground";

interface BlockingIntent {
  horizontal: HorizontalIntent;
  depth: DepthIntent;
  facing?: Direction;
}

interface DirectorAction {
  actorId: Id;
  type: string;
  targetId?: Id;
  priority: "required" | "optional";
}

interface AssetRequirement {
  id: Id;
  kind: AssetKind;
  entityType?: string;
  action?: string;
  direction?: Direction;
  environmentIntent?: string;
  required: boolean;
}
```

DirectorPlan 禁止包含：

```text
像素位置
精确 Scale
精确 Frame
纹理路径
Pixi Container
FFmpeg 参数
未注册动作
```

### 8.1 Human Director Override

人工审核不得直接修改 RenderPlan。人工意见必须以可追溯的 Override 应用到原始 DirectorPlan，形成 Effective DirectorPlan，再完整编译：

```text
Gemini DirectorPlan
→ Human Overrides
→ Effective DirectorPlan
→ Schema / Capability Validation
→ Compiler
→ RenderPlan
```

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface DirectorOverride {
  id: Id;
  baseDirectorPlanHash: string;
  targetPath: string;
  operation: "replace" | "remove" | "insert";
  value?: JsonValue;
  reason: string;
  createdBy: string;
  createdAt: string;
}

interface EffectiveDirectorPlan {
  sourceDirectorPlanHash: string;
  overrideIds: Id[];
  effectivePlanHash: string;
  plan: DirectorPlan;
}
```

Override 规则：

- `targetPath` 使用项目冻结的 JSON Pointer/Domain Path 规范，M0 必须选定一种并测试；
- Override 按显式顺序应用，推荐按审核列表顺序并以 ID 打破同时间排序；
- `baseDirectorPlanHash` 不匹配时 Override 失效，禁止静默套用到重新生成的计划；
- `remove` 不携带 `value`，`replace` 和 `insert` 必须携带 `value`；
- 应用后必须重新执行 DirectorPlan Schema 与 Capability Validation；
- Override 不能绕过受限动作、Attachment 或环境能力；
- 路径不存在、多个 Override 冲突或应用结果非法时必须返回 Override Error；
- 原始 DirectorPlan、Override 列表和 Effective DirectorPlan Hash 必须全部保留用于审计；
- Override 只失效 Compiler 及其下游任务，不应重新生成未受影响的 AI 资产或 TTS。

生命周期：

```text
M0：冻结 Schema 和纯函数 applyOverrides()
M2：规则式 DirectorPlan 闭环中验证 Override → Recompile
M5：接入 Gemini 与人工审核 UI
M6：完善冲突、历史和回滚界面
```

---

## 9. Capability Catalog

Capability Catalog 是 AI 世界与程序世界之间的能力合同。

```ts
interface CapabilityCatalog {
  schemaVersion: string;
  catalogVersion: string;
  entityCapabilities: EntityCapability[];
  cameraCapabilities: CameraCapability[];
  environmentCapabilities: EnvironmentCapability[];
  fallbackRules: FallbackRule[];
}

interface EntityCapability {
  entityType: string;
  poseClips: string[];
  actions: ActionCapability[];
  attachmentSlots: string[];
}

interface ActionCapability {
  action: string;
  requiredPoseClips: string[];
  targetTypes?: string[];
  minDurationFrames: number;
  supportsDirections: Direction[];
  attachmentMode?: AttachmentMode;
}

interface CameraCapability {
  intent: CameraIntent;
  minDurationFrames: number;
  allowedShotTypes: DirectorShot["shotType"][];
}

interface EnvironmentCapability {
  environmentId: Id;
  allowedEntityTypes: string[];
  supportedDepthIntents: DepthIntent[];
}

interface FallbackRule {
  unsupportedAction: string;
  replacementActions: string[];
  reason: string;
}
```

Capability Catalog 生命周期：

```text
M0：定义 Schema 和最小能力集
M2：规则式 DirectorPlan 已执行能力检查
M3/M4：PoseClip 与 AI 资产持续注册能力
M5：Gemini 受 Catalog 约束并支持 Rewrite/Fallback
```

---

## 10. RenderPlan 与 Timeline

### 10.1 RenderPlan

```ts
interface CompileProvenance {
  compilerVersion: string;
  sourceDirectorPlanHash: string;
  effectiveDirectorPlanHash: string;
  directorOverrideIds: Id[];
  capabilityCatalogVersion: string;
  compiledAt: string;
  warnings: CompileWarning[];
}

interface CompileWarning {
  code: string;
  message: string;
  path?: string;
}

interface RenderPlan {
  schemaVersion: string;
  project: ProjectSpec;
  assets: AssetManifest;
  environments: EnvironmentDefinition[];
  entities: EntityDefinition[];
  instances: EntityInstance[];
  poseClips: PoseClip[];
  timeline: Timeline;
  provenance: CompileProvenance;
}
```

RenderPlan 生成后不可被 Renderer 修改。任何修改必须回到 DirectorPlan、资产或人工 override，再重新编译。

进入 Paper Engine 前必须调用 `validateRenderPlanIntegrity()`，检查跨对象的 Asset、PoseClip、EntityDefinition/Instance、Environment、Shot、Track、Ownership、Attachment Slot/Anchor 和 Audio 引用；单文件 Zod Schema 通过不代表跨引用完整。

### 10.2 Timeline

Timeline Schema v1 从 M0 定义完整时间合同；暂未实现的轨道可以为空，避免 M2 音频闭环时再引入竞争时间源。

```ts
interface Timeline {
  schemaVersion: "1.0.0";
  fps: number;
  durationFrames: number;
  shots: Shot[];
  entityTracks: EntityTrack[];
  cameraTracks: CameraTrack[];
  poseEvents: PoseEvent[];
  poseTransitions: PoseTransition[];
  ownershipEvents: OwnershipEvent[];
  visibilityEvents: VisibilityEvent[];
  effectEvents: EffectEvent[];
  narration: NarrationCue[];
  subtitles: SubtitleCue[];
  sfx: SfxCue[];
  transitions: Transition[];
  markers: TimelineMarker[];
}

interface Shot {
  id: Id;
  sceneId: Id;
  environmentId: Id;
  range: FrameRange;
  focusEntityId?: Id;
}
```

### 10.3 Track 与 Keyframe

```ts
type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold";

interface Keyframe<T> {
  frame: Frame;
  value: T;
  easing: Easing;
}

interface EntityTrack {
  entityId: Id;
  groundPosition?: Keyframe<GroundPoint>[];
  worldPosition?: Keyframe<Point>[];
  scale?: Keyframe<Point>[];
  rotation?: Keyframe<number>[];
  opacity?: Keyframe<number>[];
}

interface CameraTrack {
  shotId: Id;
  position: Keyframe<Point>[];
  zoom: Keyframe<number>[];
  rotation?: Keyframe<number>[];
}
```

地面角色优先使用 `groundPosition`；飞行特效或固定 UI 才使用 `worldPosition`。同一 Entity 同一 Frame 不得同时解析出两种位置来源。

Timeline V1 强制不变量：

```text
所有 Keyframe 数组按 frame 严格递增，禁止同帧重复
EntityTrack 按 entityId 唯一
CameraTrack 按 shotId 唯一
PoseEvent 按 entityId + frame 唯一
scale.x / scale.y > 0
camera.zoom > 0
opacity 位于 0..1
shots[0].startFrame = 0
shots[i].endFrame = shots[i + 1].startFrame
lastShot.endFrame = durationFrames
```

### 10.4 Pose 与 Visibility Event

```ts
interface PoseEvent {
  id: Id;
  frame: Frame;
  entityId: Id;
  poseClipId: Id;
  clipStartOffset: number;
  playbackRate: number;
}

type PoseTransitionMode = "cut" | "crossfade" | "hold-then-cut";
type PoseTransitionAnchorPolicy = "foot" | "center";

interface PoseTransition {
  id: Id;
  entityId: Id;
  fromPoseClipId: Id;
  toPoseClipId: Id;
  startFrame: Frame;
  durationFrames: number;
  mode: PoseTransitionMode;
  anchorPolicy: PoseTransitionAnchorPolicy;
}

interface VisibilityEvent {
  id: Id;
  frame: Frame;
  entityId: Id;
  visible: boolean;
}

interface EffectEvent {
  id: Id;
  frame: Frame;
  effectType: string;
  assetId?: Id;
  targetEntityId?: Id;
  durationFrames?: number;
  parameters?: Record<string, number | string | boolean>;
}
```

`playbackRate` 只调整 Clip 外观播放速度，不改变 Entity 位移。Compiler 需要限制合理范围，避免动作像快进或慢放。

Pose Transition 约束：

- `cut` 的 `durationFrames` 必须为 0；
- MVP 的 `crossfade` 建议限制为 2～4 Frame，禁止 Morph；
- `hold-then-cut` 在持续区间保持旧 Pose，并在区间结束切换；
- 有效切换帧严格定义为：

```ts
const effectiveSwitchFrame =
  transition.mode === "hold-then-cut"
    ? transition.startFrame + transition.durationFrames
    : transition.startFrame;
```

- `cut`：`PoseEvent.frame = startFrame`；
- `crossfade`：to Pose 从 `startFrame` 开始参与渲染，`PoseEvent.frame = startFrame`；
- `hold-then-cut`：持续区间只渲染旧 Pose，`PoseEvent.frame = startFrame + durationFrames`；
- Transition 必须与 `effectiveSwitchFrame` 上选择 `toPoseClipId` 的 PoseEvent 对应；
- `anchorPolicy = "foot"` 时，两张完整 Sprite 都使用各自 Foot Anchor 对齐同一世界脚点；
- `anchorPolicy = "center"` 只用于不接地对象或经审核的特殊转场；
- Crossfade 期间允许同一逻辑 Entity 输出 from/to 两个临时 Sprite，但必须带同一 Transition ID、互补 Opacity 和确定性排序键；QA 不将其误判为重复角色。

### 10.5 音频与字幕

```ts
interface NarrationCue {
  id: Id;
  range: FrameRange;
  assetId: Id;
  text: string;
  sampleStart: number;
  sampleLength: number;
}

interface SubtitleCue {
  id: Id;
  range: FrameRange;
  text: string;
  styleId: Id;
}

interface SfxCue {
  id: Id;
  frame: Frame;
  assetId: Id;
  eventType: string;
  gainDb: number;
}

interface CutTransition {
  id: Id;
  fromShotId: Id;
  toShotId: Id;
  type: "cut";
  frame: Frame;
}

interface TimedTransition {
  id: Id;
  fromShotId: Id;
  toShotId: Id;
  type: "crossfade" | "paper-wipe";
  range: FrameRange;
}

type Transition = CutTransition | TimedTransition;

interface TimelineMarker {
  id: Id;
  frame: Frame;
  type: string;
  entityIds?: Id[];
}
```

---

## 11. Duration Solver

Shot 时长不是 TTS 时长的简单复制，而是多个约束的求解结果。

```ts
interface DurationRequirement {
  source: "narration" | "action" | "camera" | "subtitle" | "transition";
  minimumFrames: number;
  preferredFrames?: number;
  priority: "hard" | "soft";
  reason: string;
}

interface DurationSolution {
  durationFrames: number;
  appliedAdjustments: DurationAdjustment[];
  unresolved: DurationRequirement[];
}

interface DurationAdjustment {
  type:
    | "extend-shot"
    | "split-shot"
    | "split-narration"
    | "adjust-tts-rate"
    | "remove-optional-action"
    | "rewrite-director-plan";
  deltaFrames?: number;
  reason: string;
}
```

基本规则：

```text
requiredDuration = max(
  narrationRequirement,
  actionRequirement,
  cameraRequirement,
  subtitleRequirement,
  transitionRequirement
)
```

冲突处理优先级：

1. 延长 Shot；
2. 拆分 Shot；
3. 调整 Narration 分句；
4. 在安全范围内调整 TTS 语速；
5. 删除 optional Action；
6. Rewrite DirectorPlan；
7. 返回 Compile Error。

不得为了塞入旁白而违反动作最小时长，也不得把必要动作压缩成明显快进。

### 11.1 两段式编译与 TTS 测量

Compiler 必须分为 Preflight Compile 和 Final Compile。Preflight 不生成 Timeline，只生成 Final Compile 所需的确定性输入：

```text
Story
→ DirectorPlan
→ Human Override
→ Preflight Compile
   - Schema / Override / Capability
   - Action Expansion
   - Narration Segmentation
   - TTS Requirements
→ Qwen TTS
→ Audio Measurement / FFprobe
→ Final Compile
   - Duration Solver
   - Spatial / Camera
   - Pose / Transition / Ownership
   - Tracks / Subtitle / SFX
→ RenderPlan + Canonical Timeline
```

```ts
interface TtsRequirement {
  id: Id;
  shotId: Id;
  segmentId: Id;
  text: string;
  voiceId: Id;
  requestedRate: number;
  language: string;
  inputHash: string;
}

interface PreflightCompileResult {
  schemaVersion: string;
  effectiveDirectorPlanHash: string;
  expandedActions: DirectorAction[];
  ttsRequirements: TtsRequirement[];
  assetRequirements: AssetRequirement[];
  warnings: CompileWarning[];
}

interface MeasuredAudio {
  requirementId: Id;
  assetId: Id;
  sampleRate: number;
  sampleLength: number;
  durationSeconds: number;
  measurementProducer: ProducerRef;
}

interface FinalCompileInput {
  preflight: PreflightCompileResult;
  measuredAudio: MeasuredAudio[];
}
```

系统仍然只有一个 Canonical Timeline。Preflight Compile 不是临时时间轴，也不得产生与 Final Timeline 竞争的 Shot Frame。

如果 Final Duration Solver 决定拆分 Narration 或调整 TTS Rate，则生成新的 TtsRequirement，仅重新执行受影响的 TTS Task 和 Audio Measurement，然后再次运行 Final Compile。未经重新测量的估算音频不得进入最终 RenderPlan。

---

## 12. Timeline Compiler

Compiler 按两个阶段执行固定 Pass：

```text
Preflight Compile
1. Source DirectorPlan Schema Validation
2. DirectorOverride Hash / Path / Conflict Validation
3. Apply Overrides → Effective DirectorPlan
4. Effective DirectorPlan Schema Validation
5. Capability Validation
6. Entity / Environment Resolution
7. Action Expansion
8. Narration Segmentation
9. TTS / Asset Requirement Generation
10. Preflight Result Freeze + Hash

External Measured Inputs
11. TTS Generation
12. Audio Measurement / FFprobe

Final Compile
13. Validate Preflight Hash / Measured Inputs
14. Duration Solving
15. Blocking → GroundPoint
16. Camera Planning
17. Pose / Transition / Ownership / Visibility Event Generation
18. Track / Subtitle / SFX Generation
19. Timeline Integrity Validation
20. RenderPlan + Canonical Timeline Freeze + Hash
```

### 12.1 编译错误

```ts
type CompileErrorCode =
  | "INVALID_DIRECTOR_PLAN"
  | "INVALID_DIRECTOR_OVERRIDE"
  | "UNSUPPORTED_CAPABILITY"
  | "MISSING_ASSET"
  | "MISSING_POSE_CLIP"
  | "INVALID_OWNERSHIP"
  | "DURATION_UNSATISFIABLE"
  | "BLOCKING_UNRESOLVABLE"
  | "CAMERA_UNRESOLVABLE"
  | "TIMELINE_CONFLICT";

interface CompileError {
  code: CompileErrorCode;
  message: string;
  path?: string;
  recoverable: boolean;
  suggestedFallbacks?: string[];
}
```

### 12.2 Rewrite 与 Fallback

```text
Gemini 请求 farmer rides horse
↓
CapabilityValidator
↓
UNSUPPORTED_CAPABILITY: ride / horse
↓
Catalog Fallback: walk + exit
↓
Rewrite DirectorPlan
↓
重新完整编译
```

Renderer 永远不会收到 `ride` 并“尽量渲染”。

---

## 13. Frame Evaluator

### 13.1 接口

```ts
interface FrameEvaluator {
  evaluate(plan: RenderPlan, frame: Frame): RenderState;
}

interface RenderState {
  frame: Frame;
  shotId: Id;
  environmentId: Id;
  camera: CameraState;
  sprites: SpriteRenderState[];
  effects: EffectRenderState[];
  subtitle?: SubtitleRenderState;
}

interface SpriteRenderState {
  renderId: Id;
  entityId?: Id;
  assetId: Id;
  transform: Transform2D;
  anchor: Point;
  renderLayer: RenderLayerName;
  zIndex: number;
  depth: number;
  stableSortKey: string;
  visible: boolean;
  owner: OwnerRef;
  poseTransition?: {
    transitionId: Id;
    role: "from" | "to";
  };
}

interface EffectRenderState {
  effectId: Id;
  effectType: string;
  assetId?: Id;
  transform?: Transform2D;
  progress: number;
  parameters?: Record<string, number | string | boolean>;
}

interface SubtitleRenderState {
  cueId: Id;
  text: string;
  styleId: Id;
  opacity: number;
}
```

所有可渲染 Sprite 必须按以下元组升序排序：

```text
renderLayerOrder
→ zIndex
→ depth
→ stableSortKey
```

`renderLayerOrder` 来自冻结的层级表；`depth` 约定远处小、近处大，因此近处对象后绘制。`stableSortKey` 由 Compiler/Evaluator 确定性生成，推荐包含 Entity ID、用途和 Transition Role。比较时使用 Unicode code unit 顺序，禁止依赖区域设置相关的 `localeCompare()`。

只要排序元组完全相同，`stableSortKey` 仍必须唯一。Renderer 不得依赖数组插入顺序、对象枚举顺序或底层排序稳定性决定遮挡关系。

RenderState Schema 还必须验证 `sprites` 已按上述元组处于 Canonical Sort；Renderer 只消费顺序，不得再次排序或决定遮挡语义。

### 13.2 确定性约束

```text
相同 RenderPlan Hash
+ 相同 Frame
+ 相同 Evaluator Version
= 相同 RenderState
```

Evaluator 禁止：

```text
x += speed
读取上一帧可变对象
读取墙钟时间
使用未固定种子的随机数
依赖 Pixi 当前场景状态
异步请求资产
修改 RenderPlan
```

### 13.3 求值顺序

建议固定为：

```text
1. 验证 Frame 范围
2. 解析当前 Shot / Environment
3. 求 CameraState
4. 解析 Entity 生命周期与 Visibility
5. 解析 Ownership
6. 求 Entity Track
7. 解析 PoseClip、PoseTransition 与当前 Clip Frame
8. Ground Projection
9. Foot Anchor Compensation / Ground Lock
10. Attachment / Baked Composite 解析
11. 应用确定性 Micro Motion
12. 按 RenderLayer / zIndex / depth / stableSortKey 排序
13. 求 Subtitle / Effect
14. 输出不可变 RenderState
```

### 13.4 Foot Anchor Compensation

角色的 Timeline 位置代表 `worldFootPosition`，不是 Sprite 左上角。

对于图片尺寸 `(w,h)`、缩放 `(sx,sy)` 和归一化 Anchor `(ax,ay)`：

```ts
spriteRenderX = worldFootX - ax * w * sx;
spriteRenderY = worldFootY - ay * h * sy;
```

如果 Anchor 使用 Pixi 原点能力，可以等价表达为：

```ts
sprite.anchor.set(ax, ay);
sprite.position.set(worldFootX, worldFootY);
```

所有 Pose 帧都必须重新读取自己的 Foot Anchor。禁止假定一个角色所有 Pose 使用同一 Anchor。

Ground Lock 在基础 Anchor Placement 之后执行：

```text
mode = always
  始终按 referenceFoot 对齐当前 Ground Projection

mode = contact-only
  只在 contact 为 left-foot / right-foot / both 时锁定参考脚
  none 阶段保留 PoseClip 自身的非接触运动

mode = none
  只进行标准 Sprite Anchor Placement，不施加接触脚修正
```

对于 `contact-only`，Evaluator 必须根据目标 Frame 直接找到当前连续接触区间的起始帧，并求得该接触脚的参考世界点；禁止依赖上一帧缓存累积。修正只允许平移完整 Sprite，并受 `maxCorrectionPx` 限制。超过限制表示 PoseClip、Track 或 Anchor 不一致，必须报告 QA 错误而不是继续拉扯人物。

### 13.5 Micro Motion

微动作必须是 Frame 的纯函数：

```ts
offsetY = amplitude * sin((frame + phaseSeed) * frequency);
rotation = rotationAmplitude * sin((frame + phaseSeed) * frequency);
```

随机相位由项目 Seed、Entity ID 和效果 ID 派生，禁止运行时调用无种子的 `Math.random()`。

---

## 14. PixiJS Renderer Adapter

### 14.1 职责

Pixi Adapter 只负责：

```text
Texture 加载与缓存
Sprite / Container 创建销毁
Mask / Filter
Transform 应用
排序与显示隐藏
Canvas 渲染
Frame 导出
GPU 资源释放
```

不负责：

```text
Action 规划
Timeline 插值
Duration 求解
Ownership 决策
Foot Anchor 推理
AI Fallback
故事理解
```

### 14.2 React 边界

React 可以创建 Preview 容器并控制播放状态：

```ts
const state = evaluator.evaluate(renderPlan, frame);
pixiRenderer.apply(state);
```

播放过程中不得对每个 Sprite 使用 React `setState` 驱动 position、scale、rotation。

### 14.3 Preview 与 Final

Preview 与 Final 必须共享：

```text
同一 RenderPlan
同一 Evaluator
同一 RenderState Contract
同一 Pixi Adapter 核心
```

允许差异：

```text
Preview：640×360 / 15 或 30FPS 显示
Final：1280×720 / 30FPS 输出
```

降低 Preview 质量不得改变 Frame、Track 或事件语义。

### 14.4 视频导出决策

M0 必须并行验证：

```text
A. PixiJS Frame Export → FFmpeg
B. Remotion 外层 Adapter → PixiJS/WebGL → FFmpeg
```

选择依据：

- 关键帧一致性；
- 字体、Alpha、颜色空间正确性；
- 300 帧渲染时间；
- 显存和内存峰值；
- 崩溃恢复能力；
- 音频和字幕组合复杂度。

最终选择应记录为单独 ADR，不在本基线中预判。

---

## 15. Task Graph 与内容寻址

### 15.1 TaskNode

```ts
type TaskStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "invalidated"
  | "cancelled";

interface TaskNode {
  nodeId: Id;
  type: string;
  inputHash: string;
  promptHash?: string;
  modelId?: string;
  modelVersion?: string;
  workflowVersion: string;
  producer: ProducerRef;
  seed?: number;
  outputHash?: string;
  dependencies: Id[];
  status: TaskStatus;
  attempts: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
```

`producer` 用于标识真正产生输出的工具，例如：

```json
{
  "producer": {
    "name": "anchor-estimator",
    "version": "1.3.0"
  }
}
```

Compiler、抠图脚本、Anchor 推断器、FFmpeg 封装器和图片后处理器都必须提供 ProducerRef。Task Cache Key 至少包含：

```text
inputHash
+ dependency output hashes
+ producer.name / producer.version
+ modelId / modelVersion（如适用）
+ workflowVersion
+ seed（如适用）
```

工具实现或行为变化必须提升 Producer Version，避免错误命中旧缓存。

### 15.2 第一版实现

```text
SQLite：TaskNode、依赖关系、状态、Hash、审核结果
Filesystem：图片、音频、RenderPlan、Preview、Final Video
```

不要求第一版使用 Redis、RabbitMQ 或云端队列。

### 15.3 失效传播

修改 `farmer-pickup` Prompt 时：

```text
farmer-pickup asset
→ 使用该资产的 RenderPlan/Shot
→ 对应 Preview
→ Final Video
```

不应失效：

```text
兔子资产
背景资产
无关 Shot
Narration（文本未改变时）
```

所有 Task 必须幂等。相同输入 Hash、模型版本、Workflow 和 Seed 应命中缓存或得到可追踪的新版本。

### 15.4 Canonical Hash V1

持久化 Hash 统一使用：

```text
Canonical JSON V1
→ UTF-8
→ SHA-256
→ lowercase hexadecimal
```

对象键按 Unicode code unit 升序；数组保持原顺序；禁止 `undefined`、NaN 和 Infinity；`-0` 规范为 `0`。持久化 Hash 必须增加 `canonicalVersion` 和 `domain` 包装，避免 Asset、Task、Plan 相同 JSON 产生跨域碰撞。完整决策见 `docs/adr/ADR-002-canonical-json-sha256.md`。

---

## 16. AI Asset Pipeline

### 16.1 资产请求

```ts
interface AssetRequest {
  id: Id;
  kind: AssetKind;
  entityDefinitionId?: Id;
  poseClipSpec?: {
    action: string;
    direction: Direction;
    frameCount: number;
  };
  styleGuideId: Id;
  identityReferenceAssetIds: Id[];
  prompt: string;
  negativePrompt?: string;
  seed: number;
  workflowVersion: string;
}
```

### 16.2 处理流程

```text
Asset Request
→ ComfyUI / Flux
→ 原始输出
→ Matting / Alpha Refinement
→ Canvas Normalize
→ Anchor Estimate
→ PoseClip Package
→ Asset QA
→ Human Review（必要时）
→ Asset Manifest
```

### 16.3 验收单位

AI 角色资产的验收单位是“完整动作包”，不是单张图片：

```text
Identity 一致性
服装一致性
身体比例一致性
方向一致性
画布规格一致性
Pose 连续性
Anchor 可用性
透明边缘
Clip 播放效果
```

M0 Asset Feasibility 实验不接入正式系统，但必须使用真实 AI 输出验证这些指标。

---

## 17. QA 架构

### 17.1 QA 层次

| 层 | 主要检查 |
|---|---|
| Schema QA | 类型、版本、必填字段、范围 |
| Capability QA | 动作、Pose、Camera、环境是否受支持 |
| Asset QA | Identity、Matting、Anchor、裁切、画布、透明边缘 |
| Timeline QA | 重叠、断层、Duration、生命周期、事件合法性 |
| Frame QA | 重复实体、漂浮、跳变、遮挡、越界、字幕 |
| Render QA | Preview/Final 一致性、空帧、冻结、FPS、颜色 |
| Audio QA | 音视频长度、响度、True Peak、字幕同步 |

### 17.2 MVP 硬指标

```text
Deterministic RenderState             = 100%
Timeline 非法重叠                     = 0
Missing assets                        = 0
Blank frames                           = 0
Audio/video duration delta            <= 1 frame
Foot contact drift                     <= 3 px @ 720P
Attachment discontinuity              <= 5 px @ 720P
Ownership conflicts                    = 0
Unsupported capability entering Render = 0
Duplicate stableSortKey in one Frame    = 0
Ground Lock correction overflow         = 0
Invalid PoseTransition                  = 0
```

### 17.3 关键事件抽帧

每个 Shot 的兜底抽帧：

```text
25%
50%
75%
```

同时对关键事件抽取：

```text
eventFrame - 2
eventFrame
eventFrame + 2
```

适用事件：

```text
pose change
attach
detach
collision
visibility change
shot transition
```

### 17.4 Preview / Final 一致性

固定抽帧比较 Preview 与 Final：

```text
frame 0
frame 30
frame 60
frame 90
...
关键事件帧
```

可以使用 SSIM、感知哈希和人工 Golden Frame Review。编码后不要求像素完全相等，但差异必须在预先设定阈值内。

### 17.5 QA 生命周期

```text
M0：Schema、Determinism、Renderer Comparison
M1：视觉关键帧回归
M2：Timeline、音视频、空帧
M3：Foot、Pose、Ownership、Attachment
M4：Identity、Matting、Anchor、PoseClip Package
M5：DirectorPlan、Compiler、Capability、Rewrite
M6：统一 QA Gate、审核平台和生产指标
```

---

## 18. M0～M6 实施路线

### M0：架构与 Renderer/AI Asset 双门验证

交付：

- 项目骨架；
- Schema 包和版本规则；
- Timeline v1；
- DirectorPlan、RenderPlan、RenderState 最小契约；
- PoseClip、Entity、Environment、Capability Catalog v0；
- GroundLock、PoseTransition、DirectorOverride 契约；
- Frame Evaluator 最小实现；
- Pixi Preview 和离线 Frame Export；
- FFmpeg MP4；
- 独立 AI Asset Feasibility 实验；
- 最小 QA Harness。

Renderer Gate：

```text
Pixi 实时 Preview 可运行
任意 Frame 可独立 Evaluate
相同 Frame RenderState 完全一致
离线 Frame 可导出
FFmpeg 可生成正确 MP4
Preview/Final 关键帧差异可接受
```

Asset Gate：

```text
同一角色至少 8 种状态达到最低 Identity 要求
Walk/Run 多帧能够组成可用 PoseClip
兔子左右方向与关键动作可用
far/mid/ground/foreground 能组成协调环境
Matting 质量可接受
Foot/Hand/Center Anchor 可获得并可人工修正
```

任一 Gate 失败，不进入大规模开发。

### M1：10 秒高质量视觉 Demo

建议镜头：

```text
兔子奔跑 → 撞树 → 农夫发现
```

实现：

```text
Layer / zIndex
Ground Projection
Camera / Parallax
Foreground Occlusion
Contact Shadow
Whole-body PoseClip
Foot Anchor Compensation
Micro Motion
```

退出条件：目标观众和项目负责人确认该视觉技术值得继续投入；否则回到素材分层、PoseClip、Camera 或 Ground 模型，不堆叠 AI 系统。

### M2：20～30 秒完整纵向闭环

使用人工素材与规则式 DirectorPlan：

```text
Story
→ DirectorPlan
→ Human Override
→ Preflight Compile
→ Qwen TTS
→ Audio Measurement / FFprobe
→ Final Compile
→ RenderPlan / Canonical Timeline
→ Pixi Renderer
→ Subtitle
→ FFmpeg
→ MP4
```

此阶段同时引入最小 SQLite + Filesystem Task Graph，并验证一次 `DirectorOverride → Effective DirectorPlan → Recompile`。画面可以普通，但链路必须真实闭环。

### M3：Whole-body PoseClip 动作系统

交付：

```text
PoseClip Runtime
Pose Transition
Cut / 2～4 Frame Crossfade / Hold-then-cut
Playback Rate
Foot Anchor Compensation
Ground Lock
Ownership
Socket/Baked Attachment
Visibility
Micro Motion
关键事件 QA
```

验收动作：

```text
农夫走近兔子
→ 弯腰
→ 捡起
→ Ownership 转移
→ 抱起
→ 站立
```

全过程无双角色、双兔子、明显脚滑和 Attachment 瞬移。

### M4：AI 完整角色动作包生产线

交付：

```text
AssetRequest
ComfyUI Workflow Versioning
Identity Reference
PoseClip Package
Matting
Anchor Estimate + Correction
Asset QA
局部重新生成
内容寻址缓存
```

使用 AI 资产替换 M1/M3 的人工资产，最终质量接近人工素材基线。

### M5：Gemini Director + Compiler

交付：

```text
Restricted Story Grammar
Gemini Structured DirectorPlan
Human Director Override
Capability Validation
Action Expansion
Spatial Planning
Duration Solver
Camera Planner
Rewrite / Fallback
人工审核 DirectorPlan
```

AI 不得绕过 Compiler 直接修改 RenderPlan。

### M6：QA / Review / Production

交付：

```text
统一 QA Gate
素材、计划、镜头、视频审核 UI
单项重新生成
依赖失效传播
任务重试与恢复
GPU/模型生命周期
Preview 降分辨率
Final Render 并发控制
性能基线与监控
```

---

## 19. 测试策略

### 19.1 单元测试

重点覆盖：

```text
Keyframe interpolation
Frame/seconds/sample conversion
Duration Solver
Ground Projection
PoseClip frame selection
Foot Anchor Compensation
Ground Lock mode / correction cap
Pose Transition cut / crossfade / hold-then-cut
Ownership resolution
Attachment validation
Stable render ordering
Capability validation
DirectorOverride application / conflict detection
Task cache key Producer Version invalidation
Schema migration
```

### 19.2 属性测试

适合使用随机但带 Seed 的输入验证：

```text
任意 Frame 求值不抛异常
Opacity 始终位于 0..1
Ownership 无环
正常状态：每个 Entity 的 visible Sprite <= 1
合法 Crossfade：每个 Entity 的 visible Sprite <= 2
  且两个 Sprite 的 transitionId 相同
  且 role 分别为 from / to
  且 opacity 互补
  且持续时间 <= 4 Frame
  且 stableSortKey 唯一
Shot 范围覆盖 Timeline
Track 插值结果有限且非 NaN
```

### 19.3 Golden Tests

保存：

```text
RenderState JSON Golden
关键帧 PNG Golden
短视频 Metadata Golden
Compiler Error Golden
```

Evaluator 或渲染器升级时必须显式审核 Golden 变化。

### 19.4 端到端测试

固定《守株待兔》样例作为长期回归项目：

```text
DirectorPlan Fixture
Assets Fixture
RenderPlan Fixture
Audio Fixture
Expected QA Report
Expected MP4 Metadata
```

---

## 20. 安全、版权与可追踪性

第一版至少记录：

- 模型、Workflow、Prompt、Seed 和参考资产来源；
- 生成资产的许可与使用范围；
- 声音克隆的授权和参考音频来源；
- 用户输入文本与模型输出日志；
- 最终视频可追溯到 RenderPlan Hash 和 Asset Hash；
- 外部路径、FFmpeg 参数和文件名必须经过校验，禁止直接拼接用户输入执行命令。

---

## 21. M0 必须解决的开放决策

以下问题暂不写死，但必须在 M0 实验后形成 ADR：

1. Final Render 使用 Pixi Frame Export 还是 Remotion 外层 Adapter；
2. PixiJS 使用 WebGL 的具体初始化和 Headless 渲染参数；
3. AI PoseClip 的具体 ComfyUI Workflow、模型和一致性方案；
4. Anchor 自动估计与人工修正的最低工具形态；
5. Ground Projection 使用简单四边形投影是否足够；
6. Qwen3-TTS 使用的具体模型规格、显存占用和实时率；
7. Preview/Final SSIM 或感知哈希阈值；
8. Identity 与 PoseClip 资产审核的量化/人工评分标准。
9. DirectorOverride 的 JSON Pointer/Domain Path 规范。

这些是实验性实现决策，不改变 ADR-001 的 Whole-body PoseClip 主线。

---

## 22. 项目开工前检查表

在创建正式业务代码前，应确认：

```text
[ ] ADR-001 已纳入仓库
[ ] MVP 范围已冻结
[ ] 不支持能力列表已确认
[ ] packages/schemas 是唯一 Schema 来源
[ ] Timeline 是唯一时间源
[ ] DirectorPlan / RenderPlan / RenderState 边界已确认
[ ] RenderPlan 包含 Timeline，不存在第二套执行计划
[ ] PoseClip 不包含 Root Motion
[ ] GroundLock 模式和最大修正量已声明
[ ] PoseTransition 只使用受支持模式且不进行 Morph
[ ] Ownership 与 Attachment 约束已确认
[ ] RenderState 具有唯一 stableSortKey
[ ] Task Cache Key 包含 Producer Name/Version
[ ] 人工修改通过 DirectorOverride 重新编译
[ ] Renderer 不进行故事推理
[ ] React 不驱动逐帧 Sprite reconciliation
[ ] M0 Renderer Gate 测试计划已建立
[ ] M0 Asset Gate 样例与评分方式已建立
[ ] 《守株待兔》已确定为长期回归 Fixture
```

---

## 23. 最终架构结论

项目不建设通用骨骼动画软件，也不让 AI 或 Renderer 自由发挥。系统通过明确的能力边界，把不确定性限制在可审核的 DirectorPlan 和 AI Asset Pipeline 中，把最终动画生产转化为确定性编译与逐帧求值问题。

正式主线为：

```text
Whole-body PoseClip
+ Restricted Story Grammar
+ Capability Catalog
+ Deterministic Timeline Compiler
+ Frame Evaluator
+ PixiJS Renderer
+ Content-addressed Task Graph
+ Continuous QA
```

最终目标不是支持任意故事和任意动作，而是：

> **在明确支持的故事领域和动作集合内，稳定、可重复、可局部重生地生成视觉质量可接受的 2.5D 漫剧视频。**
