# AI 纸片 2.5D 动画生成系统实施设计方案

## 一、项目目标

新项目定位为：

> **AI 生成故事规划与视觉素材，程序化 2.5D 动画引擎负责镜头、人物、分层、动作和最终视频生成。**

核心目标不是“AI 直接生成视频”，而是：

```text
AI负责：
故事理解
分镜规划
人物/背景/道具素材生成

程序负责：
时间轴
场景布局
纸片动画
镜头运动
2.5D视差
人物动作
前景遮挡
音画同步
视频输出
质量检测
```

推荐核心技术：

```text
React 19
TypeScript
Vite

PixiJS 8
@pixi/react

Node.js

Gemini
ComfyUI + Flux
Python
Qwen3-TTS

FFmpeg

可选：
Remotion
```

---

# 二、总体开发原则

整个项目不要一次做完。

建议按照：

```text
第一阶段
视觉技术验证

↓

第二阶段
动画引擎核心

↓

第三阶段
角色与动作系统

↓

第四阶段
AI素材生成接入

↓

第五阶段
故事自动导演系统

↓

第六阶段
音频与最终视频

↓

第七阶段
自动质检和审核系统

↓

第八阶段
生产化与性能优化
```

逐步推进。

每个阶段必须：

> 当前阶段验收通过，再进入下一阶段。

---

# 三、第一阶段：2.5D 视觉 Demo

## 阶段目标

第一阶段不要接：

```text
Gemini
ComfyUI
TTS
数据库
任务系统
AI审核
```

只验证：

> **PixiJS 能不能做出我们想要的 2.5D 纸片动画效果。**

这是整个项目最重要的技术验证。

---

# 四、第一阶段 Demo 内容

建议仍然使用：

> 《守株待兔》

做一个：

```text
8～12秒
1280 × 720
30FPS
```

的镜头。

人工准备素材：

```text
sky.png
mountains.png
field.png
ground.png

stump.png

farmer.png
rabbit.png

foreground-grass.png
foreground-leaves.png
```

---

# 五、第一阶段必须实现

### 1. PixiJS Scene Graph

实现：

```text
World

├── FarBackground
├── MidBackground
├── Ground
├── Props
├── Characters
├── Foreground
└── Effects
```

---

### 2. Depth

每个 Layer 都有：

```text
depth
```

例如：

```text
天空             0.05
远山             0.15
农田             0.35
树桩             0.60
农夫             0.70
兔子             0.72
前景草           0.90
前景树叶         1.00
```

---

### 3. 2.5D Parallax

Camera 移动时：

```text
远景移动慢
中景移动中等
人物移动较快
前景移动最快
```

实现参考视频中的核心效果。

---

### 4. Camera

第一阶段只实现：

```text
camera.x

camera.y

camera.zoom
```

例如：

```text
0～5秒

camera.x:
0 → 120

camera.zoom:
1 → 1.06
```

---

### 5. Ground Plane

取消：

```text
底部20%空白
```

实现：

```text
Natural Ground Plane
```

例如：

```ts
groundY(x)
```

农夫和兔子必须真正站在地面上。

---

### 6. Foreground Occlusion

实现：

```text
农夫
↓
前景草
```

让草遮住：

```text
农夫脚部5%～10%
```

---

### 7. Contact Shadow

给：

```text
农夫
兔子
树桩
```

增加轻微接触阴影。

---

### 8. Frame Driven Animation

禁止：

```text
x += speed
```

所有动画必须：

```text
frame
↓
直接计算状态
```

例如：

```ts
getCameraState(frame)
getFarmerState(frame)
getRabbitState(frame)
```

保证：

```text
Frame 100

每次渲染结果完全一致
```

---

# 六、第一阶段验收标准

第一阶段不看 AI。

只看视觉。

必须满足：

### 视觉

- 不存在底部人工留白；
- 人物看起来处于环境内部；
- 前后景明显存在空间层次；
- Camera 移动自然；
- Parallax 不夸张；
- 人物脚底不悬浮；
- 前景可以自然遮挡人物；
- 整体不再像“背景 + PNG贴纸”。

### 技术

支持：

```ts
renderFrame(0)
renderFrame(100)
renderFrame(200)
```

任意帧独立计算。

---

# 七、第一阶段最终成果

输出：

```text
demo.mp4

+
Web实时Preview
```

如果这个 10 秒 Demo：

> **视觉效果仍然不好**

暂停后续开发。

先修改：

```text
PixiJS
Scene
Depth
Camera
素材分层方式
```

直到效果满意。

---

# 八、第二阶段：Paper Animation Engine

第一阶段验证效果后，再正式开发动画引擎。

核心 Package：

```text
packages/paper-engine
```

这里是整个系统最重要的代码。

---

# 九、第二阶段目标

建立：

```text
Timeline
Scene
Shot
Entity
Track
Keyframe
Camera
Spatial
```

这些核心模型。

注意：

> `paper-engine` 不应该依赖 PixiJS。

应该：

```text
paper-engine
     ↓
paper-pixi
     ↓
PixiJS
```

---

# 十、第二阶段核心数据模型

## Timeline

```ts
Timeline {
    fps
    durationFrames
    shots[]
}
```

---

## Shot

```ts
Shot {
    id

    startFrame
    durationFrames

    sceneId

    camera

    entities

    effects
}
```

---

## Entity

统一表示：

```text
人物
动物
树桩
农具
道具
```

例如：

```ts
Entity {
    id
    type
    depth
    asset
    transform
}
```

---

# 十一、第二阶段实现 Keyframe

支持：

```text
Position

Scale

Rotation

Opacity

Depth

Camera
```

例如：

```json
{
  "frame": 0,
  "x": 100
},
{
  "frame": 120,
  "x": 600
}
```

中间使用：

```text
linear
easeIn
easeOut
easeInOut
```

自动插值。

---

# 十二、第二阶段实现 Timeline Editor 基础能力

暂时不用做复杂编辑器。

只需要：

```text
播放
暂停

时间轴拖动

上一帧
下一帧

Shot选择
```

并显示：

```text
当前Frame

当前时间

当前Shot
```

---

# 十三、第二阶段实现 Shot 系统

正式区分：

```text
Scene
和
Shot
```

例如：

```text
Scene：

古代农田
```

下面：

```text
Shot 01
农田全景

Shot 02
兔子奔跑

Shot 03
树桩特写

Shot 04
农夫反应
```

背景 Location 可以复用。

Camera 不同。

---

# 十四、第二阶段验收标准

做到：

```text
完全通过JSON
```

生成一个视频。

例如：

```text
不修改React代码

只修改：

story-demo.json
```

就可以改变：

```text
Camera
人物位置
动画
镜头长度
```

这一步非常关键。

意味着：

> 动画真正数据驱动。

---

# 十五、第三阶段：角色动画系统

第三阶段开始解决：

> 人物不只是一个会移动的 PNG。

---

# 十六、第三阶段实现 Pose System

每个人物拥有：

```text
idle

walk

run

bend

pickup

hold

sit

wait

reaction
```

PixiJS 根据 Timeline：

```text
自动切换Sprite。
```

---

# 十七、第三阶段实现 Anchor System

Python 分析素材后生成：

```json
{
  "anchors": {

    "foot": [],

    "leftHand": [],
    "rightHand": [],

    "head": [],

    "center": []
  }
}
```

至少需要：

```text
Foot Anchor

Hand Anchor

Center Anchor
```

---

# 十八、第三阶段实现 Attachment

例如：

```text
兔子
↓
Attach
↓
农夫右手
```

支持：

```text
attach
detach
```

---

## 捡兔子

动作变成：

```text
农夫走近
↓
bend
↓
手靠近兔子
↓
attach(rabbit → rightHand)
↓
stand
↓
hold
```

这样解决旧系统：

```text
手里一只兔子
地上还有一只兔子
```

的问题。

---

# 十九、第三阶段实现 Entity State Machine

原则：

```text
一个Entity
一个Frame
一个Primary State
```

禁止：

```text
idle农夫
+
pickup农夫
```

同时出现。

解决：

> 双农夫。

---

# 二十、第三阶段增加基础程序动画

除了 Pose：

再增加：

```text
Body Bob
Swing
Breathing
Shake
Bounce
Squash
Stretch
```

例如走路：

```text
Pose
+
上下轻微移动
+
轻微rotation
```

让纸片不再完全僵硬。

---

# 二十一、第三阶段验收标准

必须能够实现一个完整动作：

> 农夫走到兔子旁边 → 弯腰 → 捡兔子 → 抱起 → 站立。

全过程：

- 人物不重复；
- 兔子不重复；
- 无明显瞬移；
- Anchor 正常；
- 人物脚底基本锁定；
- Attachment 正确。

---

# 二十二、第四阶段：AI 素材生成系统

前三个阶段全部使用人工素材。

直到动画引擎稳定以后：

> 才接 ComfyUI。

---

# 二十三、第四阶段实现 Asset Pipeline

流程：

```text
Asset Request
↓
ComfyUI
↓
Flux
↓
PNG
↓
Python Audit
↓
Asset Package
```

---

# 二十四、人物资产结构

例如：

```text
farmer/
│
├── identity.png
│
├── idle.png
│
├── walk.png
│
├── run.png
│
├── bend.png
│
├── pickup.png
│
├── hold.png
│
└── entity.json
```

---

# 二十五、第四阶段升级抠图

继续保留：

```text
洋红背景
+
HSV
```

作为 Fast Path。

然后增加：

```text
边缘去色
Alpha Refinement
```

未来再考虑：

```text
AI Segmentation Fallback
```

---

# 二十六、第四阶段背景改造

不再生成：

```text
background.png
```

一张背景。

改成：

```text
Environment Package
```

例如：

```text
farm/
│
├── far.png
├── mid.png
├── ground.png
├── foreground.png
├── environment.json
└── preview.png
```

---

# 二十七、environment.json

例如：

```json
{
  "horizonY": 0.42,

  "groundPlane": {},

  "walkableZones": [],

  "occlusionZones": [],

  "layers": []
}
```

完全删除：

```text
bottomSafeArea = 20%
```

---

# 二十八、第四阶段资产审核

检查：

```text
人物数量
动物数量
背景人物
背景动物
错误文字
透明边缘
洋红残留
人物裁切
Ground完整性
明显空白区域
```

---

# 二十九、第四阶段验收

使用 AI 自动生成：

```text
农夫
兔子
树桩
农田
```

不人工修改图片。

直接进入前三阶段完成的 Animation Engine。

最后效果必须接近：

> 第一阶段人工素材 Demo。

如果质量突然明显下降：

说明问题在：

```text
AI Asset Pipeline
```

而不是动画引擎。

非常容易定位。

---

# 三十、第五阶段：AI Director / 故事自动导演

第五阶段才接：

```text
Gemini
```

---

# 三十一、Gemini 不负责像素坐标

Gemini 输出：

```text
故事圣经

Scene

Shot

Action

Blocking

Camera Intent

Entity Relations
```

例如：

```json
{
  "shotType": "medium",

  "focus": "rabbit",

  "camera": "slow-push-in",

  "blocking": {

    "farmer": "left-midground",

    "rabbit": "center-ground"

  },

  "action": {
    "actor": "farmer",
    "type": "pickup",
    "target": "rabbit"
  }
}
```

---

# 三十二、第五阶段实现 Blocking

这是新系统和 V5 最大的区别之一。

Blocking：

> 描述角色在镜头中的场面调度。

例如：

```text
农夫：

左侧
中景
面朝右
```

兔子：

```text
右侧
近景
向左奔跑
```

然后：

```text
Spatial Engine
```

计算真正：

```text
x
y
depth
scale
```

---

# 三十三、第五阶段实现 Spatial Engine

输入：

```text
Shot

Environment

Ground Plane

Entity

Blocking
```

输出：

```text
position

scale

depth

orientation
```

例如：

```text
Gemini：

left-midground
```

程序转换：

```text
x = 0.28

depth = 0.58

y = groundY(x)

scale = depthScale(...)
```

---

# 三十四、第五阶段实现 Camera Planner

Gemini 只输出：

```text
slow-push-in
pan-right
static
follow
```

程序转换成：

```text
Camera Keyframes。
```

例如：

```text
slow-push-in

↓

zoom:
1.0 → 1.06

x:
20 → 70
```

---

# 三十五、第五阶段验收

输入一篇故事：

```text
《守株待兔》
```

系统自动产生：

```text
Story Bible

Scene

Shots

Actions

Blocking

Camera

Asset Requirements
```

经过人工审核后：

```text
无需手工编写Timeline JSON
```

即可进入动画生成。

---

# 三十六、第六阶段：TTS 与音画统一

这一步开始处理声音。

使用：

```text
Qwen3-TTS
```

---

# 三十七、正确生成顺序

一定要：

```text
Gemini
↓
Shot + Narration
↓
TTS
↓
FFprobe真实时长
↓
Timeline Builder
↓
动画
```

禁止：

```text
先猜镜头长度
↓
再强塞TTS
```

---

# 三十八、第六阶段建立唯一 Timeline

整个系统：

> 只能有一份时间源。

例如：

```text
timeline.json
```

负责：

```text
Shot

Camera

Entity

Pose

Attachment

Subtitle

Narration

SFX

Transition
```

所有模块：

```text
只读 Timeline。
```

---

# 三十九、字幕

第一版：

```text
Sentence Level Timestamp
```

即可。

以后升级：

```text
Word Level Timestamp。
```

---

# 四十、第六阶段增加 SFX Event

例如：

```text
rabbit_collision
farmer_step
pickup
paper_transition
```

音效绑定：

```text
Event Frame
```

而不是：

```text
大概第3秒
```

---

# 四十一、第六阶段最终输出

两种方案：

### 方案A

```text
PixiJS
↓
逐帧输出
↓
FFmpeg
```

### 方案B

```text
Paper Engine
↓
Remotion Adapter
↓
Remotion Render
↓
FFmpeg
```

我建议第一版：

> 继续使用 Remotion 作为 Render Adapter。

因为最终视频渲染能力比较成熟。

但：

> 动画逻辑不能放进 Remotion。

---

# 四十二、第七阶段：自动质量检测

V5 最大的问题之一：

> 程序成功 ≠ 视频正确。

所以新项目必须建立：

```text
QA Gate
```

---

# 四十三、Asset QA

检查：

```text
素材数量
人物
背景
透明边缘
姿态
Anchor
```

---

# 四十四、Timeline QA

检查：

```text
Shot重叠

Shot断层

异常Duration

字幕过长

Timeline总长度

Entity生命周期
```

例如：

```text
普通Shot > 12秒

Warning
```

```text
普通Shot > 20秒

Error
```

---

# 四十五、Composition QA

每个 Shot 抽：

```text
25%
50%
75%
```

三帧。

检查：

```text
人物重复

人物漂浮

人物越界

人物比例

主体遮挡

背景空白

前景错误

字幕位置
```

---

# 四十六、Final Video QA

最终 MP4 检查：

```text
冻结

黑帧

低Motion

字幕长时间不变

音视频长度

FPS

Color Space

音量

True Peak
```

这样就可以自动发现之前：

```text
19～79秒同一镜头
```

这种严重错误。

---

# 四十七、第八阶段：审核平台

这时才开始完善前端管理系统。

审核流程：

```text
故事
↓
导演计划
↓
人物
↓
背景
↓
Shot Layout
↓
Animation Preview
↓
Composition QA
↓
Final Preview
↓
Render
```

---

# 四十八、单项重生

必须支持：

```text
重新生成：

某个人物

某个Pose

某张背景

某一个Shot

某个音频
```

禁止：

```text
一点错误
→
整个视频重新生成
```

---

# 四十九、第九阶段：性能与生产化

前八阶段稳定之后再优化性能。

包括：

```text
素材Cache

纹理Atlas

Lazy Load

GPU资源释放

任务队列

并发控制

Preview降分辨率

Final Render并发

模型生命周期
```

---

# 五十、针对当前设备的建议

当前设备更适合：

```text
AI任务串行

Render和Flux不要同时跑

TTS完成后释放模型

ComfyUI完成后释放显存/共享内存
```

Preview：

```text
640×360
15FPS
```

Final：

```text
1280×720
30FPS
```

第一阶段没有必要直接：

```text
1080P
4K
```

---

# 五十一、完整阶段路线

最终推荐：

| 阶段 | 核心目标 | AI |
|---|---|---|
| Phase 1 | 2.5D视觉Demo | ❌ |
| Phase 2 | Paper Engine / Timeline | ❌ |
| Phase 3 | 人物动作 / Anchor / Attachment | ❌ |
| Phase 4 | ComfyUI AI素材 | ✅ |
| Phase 5 | Gemini导演系统 | ✅ |
| Phase 6 | TTS / 音画Timeline | ✅ |
| Phase 7 | 自动QA | ✅ |
| Phase 8 | 人工审核平台 | ✅ |
| Phase 9 | 性能和生产化 | ✅ |

---

# 五十二、最重要的三个里程碑

## Milestone 1

完成 Phase 1。

目标：

> **一段人工素材制作的 10 秒高质量 2.5D《守株待兔》Demo。**

这是视觉可行性证明。

---

## Milestone 2

完成 Phase 3。

目标：

> **纯 JSON 可以驱动一个完整的纸片动画故事片段。**

说明：

```text
Animation Engine
```

已经成立。

---

## Milestone 3

完成 Phase 6。

目标：

> **输入故事 → AI生成素材 → 自动动画 → 自动旁白 → 输出MP4。**

此时才算：

> 第一版真正完整的 AI 视频系统。

---

# 五十三、建议暂时不要做的功能

第一版千万不要急着做：

```text
真正3D

复杂光照

GPU粒子系统

复杂骨骼编辑器

完整AE式时间轴编辑器

多人协作

云端渲染

4K

AI视频扩散

复杂物理系统

非常复杂IK
```

这些会严重拉长项目。

第一版优先解决：

```text
画面好看

人物不漂

背景协调

动作正确

镜头自然

时间准确

视频稳定
```

---

# 五十四、推荐的新项目开发顺序

如果现在正式开工，我建议真正的 Coding 顺序就是：

```text
01
React + Vite + PixiJS

02
Layer / Depth

03
Camera / Parallax

04
GroundPlane

05
Foreground Occlusion

06
Contact Shadow

07
Frame-based Timeline

08
Shot

09
Entity

10
Keyframe

11
Pose

12
Anchor

13
Attachment

14
State Machine

15
Environment Package

16
ComfyUI

17
Gemini Director

18
Spatial Planner

19
Qwen3-TTS

20
Unified Timeline

21
Remotion Renderer

22
QA

23
Review UI

24
性能优化
```

不要打乱这个顺序。

---

# 五十五、项目最终定位

新系统最终不是：

> “AI生成几张图片，然后程序把它们移动起来。”

而是：

```text
AI Director
+
Asset Generator
+
Paper Animation Engine
+
2.5D Scene Engine
+
Timeline Engine
+
Spatial Engine
+
Audio Engine
+
QA Engine
```

组成的：

# AI 程序化 2.5D 动画生产系统

最终目标是：

> **保持 AI 素材生成的效率，同时获得接近人工 2.5D 动画制作的镜头、层次和可控性。**