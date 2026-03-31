# 个人助理 Agent 需求分析与设计

> 基于 2026-04-01 对 OpenClaw、Harness Engineering 及现有个人助理 Agent 生态的调研，
> 结合 NeuroCore 第二阶段规划（A/B/C/D/E），拆解构建个人助理的需求。

## 1. 调研总结

### 1.1 OpenClaw 架构分析

OpenClaw 是目前最完整的开源个人 AI 助手方案，核心架构：

```
WhatsApp / Telegram / Slack / Discord / ... (22+ 平台)
                       │
                       ▼
              Gateway (WebSocket 控制面)
               ws://127.0.0.1:18789
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   Pi Agent (RPC)   CLI / WebChat   Device Nodes
   (LLM + Tools)                   (macOS/iOS/Android)
```

**值得借鉴的设计**：

| 设计点 | OpenClaw 方案 | 评价 |
|---|---|---|
| 控制面 | 单 Gateway WebSocket daemon，所有 IM adapter 连入 | 简洁，local-first |
| IM 接入 | 22+ 平台适配器（Baileys/grammY/discord.js 等） | 覆盖面广 |
| 长时运行 | 48h agent timeout + 自动 compaction + 重试 | 生产级可靠 |
| 主动行为 | 心跳系统（30min 间隔），读取 HEARTBEAT.md 执行主动检查 | 解决 always-on |
| 记忆 | QMD 跨 session 查询 + workspace markdown 文件（MEMORY.md/SOUL.md） | 简单有效但缺乏结构化 |
| 子 Agent | route-based 隔离 + sessions_send 跨 session 消息 | 偏简单，无真正层级委派 |
| 设备接入 | Node 系统（node.invoke 调用设备能力） | 类似 Direction B 的 SPI |
| 安全 | Docker 沙箱隔离非主 session | 生产可用 |

**OpenClaw 的不足**：

- 无结构化认知周期（没有 Perceive→Deliberate→Act→Observe 闭环）
- 记忆系统原始（Markdown 文件），无 episodic/semantic/procedural 分层
- 子 Agent 协调是消息级的，无 Goal Tree 共享、无冲突检测
- 无预测闭环（无 PredictionStore / PredictionError）
- 无预算/策略门控（无 Amygdala 等效模块）
- 依赖 LLM 原生能力做规划，无 AutonomousPlanner

### 1.2 Harness Engineering 核心理念

Harness Engineering 是 2026 年新兴学科，核心公式：

> **Agent = Model + Harness**

Harness 是模型以外的全部基础设施：工具、记忆、中间件、验证循环、编排逻辑。关键设计模式：

| Harness 组件 | 职责 | NeuroCore 对应 |
|---|---|---|
| Memory | 注入持久化知识（MEMORY.md 等） | Hippocampal 四层记忆 |
| Virtual Filesystem | 中间状态持久化，crash 恢复 | SessionCheckpoint + Episode |
| Middleware | 拦截每次 LLM 调用（预算/循环检测/观测） | Amygdala (policy/budget) + MetaController |
| Loop Detection | 滑动窗口检测重复工具调用 | CycleEngine cycle 限制 + MetaController 冲突检测 |
| Sub-Agent Delegation | 最小权限原则启动隔离子 Agent | Direction A TaskDelegation |
| Verification | 确定性规则检查器，模型无法绕过 | PolicyProvider (warn/block) |
| Human-in-the-Loop | 知道何时暂停路由给人类 | ApprovalRequest 流程 |

**关键洞察**：NeuroCore 第一阶段已经实现了 Harness 的大部分组件。第二阶段需要补齐的是：多 Agent 委派、世界模型感知、RL 技能优化、长时规划。

### 1.3 其他参考项目

| 项目 | 核心思路 | 借鉴点 |
|---|---|---|
| AutoGPT/AgentGPT | 自主目标分解 + 迭代执行 | 规划模式，但缺少 Harness 约束易失控 |
| OpenHands | 多 Agent 软件开发 | 角色化子 Agent（coder/reviewer）|
| Dify | 可视化工作流编排 | 工作流编排 + 插件生态 |
| Coze | IM 原生 Bot 平台 | 多平台 Bot 发布、对话管理 |
| Mem0/Zep | 长期记忆服务 | 语义记忆 + 用户画像持久化 |
| LangGraph | 图结构 Agent 编排 | 状态机驱动的多步 Agent |

---

## 2. 个人助理需求全景

### 2.1 用户视角的核心场景

| # | 场景 | 描述 |
|---|---|---|
| S1 | 跨平台对话 | 在 Telegram 问了问题，在 Slack 继续追问，上下文连贯 |
| S2 | 复杂任务委派 | "帮我调研 XX 技术并写一份报告" → Agent 拆解、委派子 Agent、汇总 |
| S3 | 主动通知 | Agent 主动发现邮件中有重要日程，通过 IM 推送提醒 |
| S4 | 定时任务 | 每天早上 9 点推送新闻摘要 + 日程提醒 |
| S5 | 记忆积累 | "记住我喜欢简洁的报告格式" → 跨 session 持久化 |
| S6 | 技能复用 | 第一次手动教 Agent 格式化报告，后续自动执行 |
| S7 | 审批门控 | Agent 要发送邮件前暂停等用户确认 |
| S8 | 多设备感知 | 手机上拍的照片，Agent 自动整理到云端相册 |
| S9 | 长时任务追踪 | "帮我跟进这个项目的进度" → 持续数天/周的任务管理 |
| S10 | 知识问答 | 基于用户私有知识库（文档、邮件、聊天记录）回答问题 |

### 2.2 功能需求分解

将场景映射到 NeuroCore 的模块体系：

#### FR-PA-01: IM Gateway — 消息网关

**描述**：统一的 IM 接入层，将各平台消息协议归一化为 NeuroCore 内部事件。

**子需求**：

| ID | 需求 | 优先级 |
|---|---|---|
| FR-PA-01.1 | Telegram Bot 接入（Webhook + Long Polling） | P0 |
| FR-PA-01.2 | Discord Bot 接入（Gateway WebSocket） | P0 |
| FR-PA-01.3 | Slack Bot 接入（Socket Mode） | P0 |
| FR-PA-01.4 | 企业微信 Bot 接入（回调 + response_url） | P1 |
| FR-PA-01.5 | 飞书 Bot 接入（长连接 WebSocket） | P1 |
| FR-PA-01.6 | WhatsApp Business 接入（Webhook） | P1 |
| FR-PA-01.7 | 微信个人号接入（逆向协议，风险自担） | P2 |
| FR-PA-01.8 | iMessage 接入（macOS AppleScript bridge） | P2 |
| FR-PA-01.9 | Web Chat 内置界面 | P0 |

**验收标准**：

- AC-01.1：至少 3 个 IM 平台可通过同一 Gateway 收发消息
- AC-01.2：消息格式归一化（text/image/file/audio/action）
- AC-01.3：同一用户跨平台消息共享 session 上下文

#### FR-PA-02: Conversation Manager — 对话管理

**描述**：跨平台、跨 session 的对话状态管理。

| ID | 需求 | 优先级 |
|---|---|---|
| FR-PA-02.1 | 会话创建/恢复/重置（/new, /reset 命令） | P0 |
| FR-PA-02.2 | 对话上下文压缩（超出 token budget 时自动 summarize） | P0 |
| FR-PA-02.3 | 多轮对话状态机（等待用户输入 / 执行中 / 等待审批） | P0 |
| FR-PA-02.4 | 跨平台会话关联（同一用户在 Telegram 和 Slack 共享上下文） | P1 |
| FR-PA-02.5 | 群聊场景支持（@mention 触发、多用户隔离） | P1 |
| FR-PA-02.6 | 对话历史持久化和回放 | P0 |

**验收标准**：

- AC-02.1：100 轮以上对话不丢失关键上下文
- AC-02.2：用户在平台 A 开始对话，在平台 B 可继续

#### FR-PA-03: Task Planner — 任务规划

**描述**：将用户自然语言请求分解为可执行的多步任务计划。

| ID | 需求 | 优先级 |
|---|---|---|
| FR-PA-03.1 | 自然语言意图识别和 Goal 生成 | P0 |
| FR-PA-03.2 | 复合任务自动分解（>3 步的目标拆为子 Goal） | P0 |
| FR-PA-03.3 | 执行进度实时推送（"步骤 2/5 完成"） | P1 |
| FR-PA-03.4 | 执行失败自动重试/降级/人工升级 | P0 |
| FR-PA-03.5 | 定时任务调度（cron 表达式） | P1 |
| FR-PA-03.6 | 长时任务跨 session 继续（> max_cycles） | P1 |

**映射到 Direction E**：FR-PA-03 对应 AutonomousPlanner (FR-56)，但需增加定时调度和 IM 进度推送。

#### FR-PA-04: Sub-Agent Delegation — 子任务委派

**描述**：主 Agent 将子任务派发给专门的子 Agent 执行，汇总结果。

| ID | 需求 | 优先级 |
|---|---|---|
| FR-PA-04.1 | 任务委派协议（unicast/broadcast/auction） | P0 |
| FR-PA-04.2 | 子 Agent 结果汇总和审阅 | P0 |
| FR-PA-04.3 | 子 Agent 超时和失败处理 | P0 |
| FR-PA-04.4 | 子 Agent 沙箱隔离（最小权限） | P1 |
| FR-PA-04.5 | 嵌套委派（A→B→C，最大深度 3） | P2 |
| FR-PA-04.6 | 并行子任务执行 | P1 |

**映射到 Direction A**：完全对应 TaskDelegation (FR-28~FR-35)。

#### FR-PA-05: Proactive Engine — 主动引擎

**描述**：Agent 不仅响应用户请求，还能主动发起行为。

| ID | 需求 | 优先级 |
|---|---|---|
| FR-PA-05.1 | 心跳系统（可配置间隔，默认 30min） | P0 |
| FR-PA-05.2 | 心跳期间执行主动检查（邮件/日历/RSS/文件变化） | P0 |
| FR-PA-05.3 | 事件驱动触发（新邮件、文件变化、API webhook） | P1 |
| FR-PA-05.4 | 主动通知通过 IM 推送（带静默/通知等级控制） | P0 |
| FR-PA-05.5 | 定时提醒（用户设定的提醒事项） | P0 |
| FR-PA-05.6 | 自我目标生成（空闲时自主探索学习） | P2 |

**映射到 Direction E**：心跳系统是新增需求，不在现有 FR 中。SelfGoalGenerator (FR-58) 覆盖了 FR-PA-05.6。

#### FR-PA-06: Personal Memory — 个人记忆

**描述**：跨 session、跨平台、跨时间的个人知识管理。

| ID | 需求 | 优先级 |
|---|---|---|
| FR-PA-06.1 | 用户偏好记忆（"我喜欢简洁格式" → 永久记住） | P0 |
| FR-PA-06.2 | 对话记忆（跨 session 检索相关历史对话） | P0 |
| FR-PA-06.3 | 文档知识库（用户上传的 PDF/文档纳入知识库） | P1 |
| FR-PA-06.4 | 语义搜索（自然语言查询知识库） | P0 |
| FR-PA-06.5 | 记忆衰减（过时信息自动降权） | P1 |
| FR-PA-06.6 | 记忆隐私控制（敏感信息标记和访问控制） | P1 |

**映射到 Direction E**：FR-PA-06 对应 AutobiographicalMemory (Direction E §4.2)，但增加了文档知识库和隐私控制。

#### FR-PA-07: Skill System — 技能系统

**描述**：Agent 通过经验积累可复用的操作技能。

| ID | 需求 | 优先级 |
|---|---|---|
| FR-PA-07.1 | 技能学习（用户演示一次，Agent 记住操作流程） | P1 |
| FR-PA-07.2 | 技能匹配和自动执行（相似任务命中已有技能） | P0 |
| FR-PA-07.3 | 技能市场（预置常用技能：邮件/日历/搜索/文件管理） | P1 |
| FR-PA-07.4 | 技能评估和淘汰（不再有效的技能自动降级） | P2 |
| FR-PA-07.5 | 技能跨域迁移 | P2 |

**映射到 Direction C**：完全对应 RL Skill System (FR-44~FR-49) + 现有 SkillPromoter。

#### FR-PA-08: External Integration — 外部集成

**描述**：与用户常用服务的 API 集成。

| ID | 需求 | 优先级 |
|---|---|---|
| FR-PA-08.1 | 邮件集成（Gmail/Outlook 读取和发送） | P0 |
| FR-PA-08.2 | 日历集成（Google Calendar / Apple Calendar） | P0 |
| FR-PA-08.3 | 文件存储集成（Google Drive / Dropbox / 本地文件系统） | P1 |
| FR-PA-08.4 | 搜索引擎集成 | P0 |
| FR-PA-08.5 | Web 浏览/抓取 | P0 |
| FR-PA-08.6 | 代码执行沙箱 | P1 |
| FR-PA-08.7 | 自定义 API 集成框架 | P1 |

**映射到 Direction B**：Sensor/Actuator SPI 可用于外部 API 集成，但需要更高层的连接器抽象。

#### FR-PA-09: Safety & Alignment — 安全与对齐

**描述**：确保 Agent 行为在用户可控范围内。

| ID | 需求 | 优先级 |
|---|---|---|
| FR-PA-09.1 | 操作审批流（高风险操作暂停等待用户确认） | P0 |
| FR-PA-09.2 | 预算控制（每日/每月 LLM 调用成本上限） | P0 |
| FR-PA-09.3 | 循环检测（Agent 陷入重复操作时自动中断） | P0 |
| FR-PA-09.4 | 可纠正性（用户随时可中断/否决 Agent 行为） | P0 |
| FR-PA-09.5 | 操作审计日志（所有 Agent 行为可追溯） | P0 |
| FR-PA-09.6 | 数据隐私（用户数据本地优先，可选云端） | P1 |

**映射到现有能力**：Amygdala (Policy/Budget/Approval) + MetaController 已覆盖大部分。

#### FR-PA-10: Multi-Device — 多设备感知

**描述**：Agent 能感知和操作用户的多个设备。

| ID | 需求 | 优先级 |
|---|---|---|
| FR-PA-10.1 | 设备注册和发现 | P1 |
| FR-PA-10.2 | 跨设备状态同步（clipboard / 通知 / 文件） | P2 |
| FR-PA-10.3 | 设备能力调用（拍照、播放音频、发送通知） | P2 |

**映射到 Direction B**：完全对应 DeviceRegistry (FR-38)。

---

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Personal Assistant Layer                         │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     IM Gateway (FR-PA-01)                         │  │
│  │  Telegram │ Discord │ Slack │ 企业微信 │ 飞书 │ WhatsApp │ Web    │  │
│  └────────────────────────┬──────────────────────────────────────────┘  │
│                           │ 归一化消息                                   │
│  ┌────────────────────────┴──────────────────────────────────────────┐  │
│  │                  Conversation Manager (FR-PA-02)                  │  │
│  │  会话路由 │ 上下文压缩 │ 群聊管理 │ 跨平台关联                      │  │
│  └────────────────────────┬──────────────────────────────────────────┘  │
│                           │                                           │
│  ┌────────────────────────┴──────────────────────────────────────────┐  │
│  │                    Proactive Engine (FR-PA-05)                     │  │
│  │  心跳调度 │ 事件监听 │ 定时任务 │ 主动通知                          │  │
│  └────────────────────────┬──────────────────────────────────────────┘  │
│                           │                                           │
│  ┌────────────────────────┴──────────────────────────────────────────┐  │
│  │                  External Integration (FR-PA-08)                   │  │
│  │  邮件 │ 日历 │ 文件 │ 搜索 │ 浏览器 │ 代码沙箱 │ 自定义 API       │  │
│  └────────────────────────┬──────────────────────────────────────────┘  │
└───────────────────────────┼─────────────────────────────────────────────┘
                            │ NeuroCore Session API
┌───────────────────────────┼─────────────────────────────────────────────┐
│                    NeuroCore Runtime (Phase 2)                           │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ Cortex       │  │ Hippocampal  │  │ Cerebellar   │  │ Amygdala    │ │
│  │ Task Planner │  │ Personal     │  │ World Model  │  │ Safety &    │ │
│  │ Sub-Agent    │  │ Memory       │  │ Devices      │  │ Budget      │ │
│  │ Delegation   │  │ Knowledge    │  │ Predictions  │  │ Approval    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────────────┘ │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │ Basal Ganglia│  │ Prefrontal   │  │ Global       │                   │
│  │ Skill System │  │ Meta         │  │ Workspace    │                   │
│  │ RL Optimize  │  │ Controller   │  │ Competition  │                   │
│  └──────────────┘  └──────────────┘  └──────────────┘                   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                     Multi-Agent Bus (Direction A)                │   │
│  │  AgentRegistry │ TaskDelegation │ InterAgentBus │ Coordination   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 核心交互流

#### 用户通过 IM 发起复杂任务

```
用户 (Telegram): "帮我调研 NeuroCore 竞品，写一份对比报告发到我的邮箱"
    │
    ▼
IM Gateway: 归一化为 NeuroCore InputEvent
    │
    ▼
Conversation Manager: 创建/恢复 session，注入上下文
    │
    ▼
NeuroCore Cycle:
    Perceive: 解析意图 → "竞品调研 + 报告撰写 + 邮件发送"
    Retrieve: 检索相关记忆（用户偏好格式、历史调研经验）
    Simulate: 预测各子任务耗时和风险
    Deliberate: Workspace 竞争 → 选中 "分解为子任务委派" 策略
    Gate: 风险评估（邮件发送需审批）
    Act: TaskDelegation
    Observe: 子 Agent 执行结果
    Learn: 记录 Episode，更新技能
    │
    ├── 子 Agent A (搜索调研): 竞品列表 + 特性对比
    ├── 子 Agent B (报告撰写): Markdown 报告
    ├── 子 Agent C (格式转换): 转为 PDF
    └── 审批请求 → 用户在 Telegram 确认 → 邮件发送
    │
    ▼
IM Gateway: 推送结果到 Telegram
    "报告已发送。共调研 5 个竞品，PDF 附件 2.3MB。"
```

#### 心跳驱动的主动行为

```
Proactive Engine (每 30min):
    │
    ▼
执行心跳检查列表:
    ├── 检查邮件 inbox → 发现 3 封新邮件
    │   └── 其中有 1 封包含明天会议时间变更
    ├── 检查日历 → 明天 14:00 有会议
    ├── 检查跟进任务 → "项目 X 进度" 到了截止日期
    │
    ▼
生成主动通知:
    → Telegram 推送: "明天 14:00 的会议改为 15:00（发件人：张三）"
    → Telegram 推送: "项目 X 进度已到跟进日期，需要我帮你催一下吗？"
```

### 3.3 长时运行方案

NeuroCore 当前 `max_cycles` 是 session 级别限制。个人助理的长时运行通过 **Session Chain** 模式实现：

```
Session 1 (max_cycles=50)
    Cycle 1-10: 任务规划 + 子任务分解
    Cycle 11-30: 子 Agent 执行 + 结果收集
    Cycle 31-40: 报告生成
    Cycle 41-48: 等待用户审批
    Cycle 49-50: 保存进度 → 创建 Session 2
                          │
Session 2 (max_cycles=50) │
    Cycle 1-5: 恢复上下文 ← checkpoint
    Cycle 6-15: 邮件发送 + 确认
    Cycle 16: 完成
```

关键机制：
- **SessionCheckpoint**：session 结束前保存完整状态（Goal 进度、中间结果、子 Agent 状态）
- **Episode 跨 session 持久化**：Hippocampal Memory 的 episodic/semantic/procedural 跨 session 可检索
- **Skill 跨 session 复用**：ProceduralMemory 中的技能不随 session 销毁
- **AutonomousPlanner**：Direction E 的规划器负责跨 session 的计划编排

---

## 4. IM 平台技术规格

### 4.1 统一消息模型

```typescript
interface UnifiedMessage {
  message_id: string;
  platform: IMPlatform;
  chat_id: string;
  sender_id: string;
  timestamp: string;
  content: MessageContent;
  reply_to?: string;
  metadata: Record<string, unknown>;
}

type IMPlatform =
  | "telegram" | "discord" | "slack"
  | "wechat_work" | "feishu" | "whatsapp"
  | "web" | "imessage";

type MessageContent =
  | { type: "text"; text: string }
  | { type: "image"; url: string; caption?: string }
  | { type: "file"; url: string; filename: string; size_bytes?: number }
  | { type: "audio"; url: string; duration_ms?: number }
  | { type: "action"; action: string; params: Record<string, unknown> };
```

### 4.2 各平台技术要点

| 平台 | 接收方式 | 发送方式 | 确认超时 | 文件限制 | 长任务策略 |
|---|---|---|---|---|---|
| **Telegram** | Webhook / Long Polling | Bot API REST | 无硬性限制 | 50MB (本地 API 2GB) | 异步队列 + 消息更新 |
| **Discord** | Gateway WebSocket | REST API | 交互 3s (defer→15min) | 25MB (Nitro 500MB) | deferReply + editReply |
| **Slack** | Socket Mode (WS) / HTTP | Bolt API | 3s (ack()) | 1GB | ack() + 后台 job + say() |
| **企业微信** | HTTP 回调 | response_url | 30s | 20MB | response_url 异步回复 |
| **飞书** | 长连接 WS / Webhook | IM API | ~3s | 平台相关 | 卡片更新模式 |
| **WhatsApp** | Webhook (HTTP) | Cloud API REST | 几秒 | 100MB | 异步队列 + 跟进消息 |

### 4.3 IM Adapter SPI

```typescript
interface IMAdapter {
  platform: IMPlatform;
  start(config: IMAdapterConfig): Promise<void>;
  stop(): Promise<void>;
  sendMessage(chatId: string, content: MessageContent): Promise<string>;
  editMessage(chatId: string, messageId: string, content: MessageContent): Promise<void>;
  deleteMessage(chatId: string, messageId: string): Promise<void>;
  onMessage(callback: (message: UnifiedMessage) => void): void;
  typingIndicator(chatId: string): Promise<void>;
}

interface IMAdapterConfig {
  auth: Record<string, string>;
  webhook_url?: string;
  allowed_senders?: string[];
  rate_limit?: { messages_per_minute: number };
}
```

---

## 5. 与 NeuroCore 第二阶段的映射

### 5.1 依赖矩阵

| 个人助理需求 | 依赖的 Direction | 新增还是复用 |
|---|---|---|
| FR-PA-01 IM Gateway | 新增 | **全新组件** |
| FR-PA-02 对话管理 | 第一阶段 Session | 增强（跨平台会话、上下文压缩已有） |
| FR-PA-03 任务规划 | Direction E (FR-56) | 复用 + 增强（IM 进度推送、定时调度） |
| FR-PA-04 子任务委派 | Direction A (FR-28~35) | 完全复用 |
| FR-PA-05 主动引擎 | 新增 | **全新组件**（心跳系统） |
| FR-PA-06 个人记忆 | Direction E + 第一阶段 | 复用 Hippocampal + 增加文档知识库 |
| FR-PA-07 技能系统 | Direction C (FR-44~49) | 完全复用 |
| FR-PA-08 外部集成 | Direction B + 新增 | 复用 Device SPI + 新增服务连接器 |
| FR-PA-09 安全对齐 | 第一阶段 Amygdala | 完全复用（增强） |
| FR-PA-10 多设备 | Direction B (FR-36~43) | 完全复用 |

### 5.2 新增组件

个人助理在 NeuroCore 第二阶段之上需要 **3 个全新组件**：

| 组件 | 对应需求 | 说明 |
|---|---|---|
| **IM Gateway** | FR-PA-01 | 消息网关：IM 平台适配器 + 消息归一化 + 路由 |
| **Proactive Engine** | FR-PA-05 | 主动引擎：心跳调度 + 事件监听 + 定时任务 + 通知推送 |
| **Service Connectors** | FR-PA-08 | 服务连接器：邮件/日历/文件/搜索的高层 API 封装 |

### 5.3 包结构

```
packages/
├── im-gateway/                    (新增)
│   └── src/
│       ├── adapter/
│       │   ├── im-adapter.ts       (SPI)
│       │   ├── telegram.ts
│       │   ├── discord.ts
│       │   ├── slack.ts
│       │   ├── wechat-work.ts
│       │   ├── feishu.ts
│       │   ├── whatsapp.ts
│       │   └── web-chat.ts
│       ├── message/
│       │   ├── unified-message.ts
│       │   └── message-normalizer.ts
│       ├── conversation/
│       │   ├── conversation-manager.ts
│       │   ├── session-router.ts
│       │   └── context-compressor.ts
│       └── index.ts
├── proactive-engine/              (新增)
│   └── src/
│       ├── heartbeat/
│       │   ├── heartbeat-scheduler.ts
│       │   └── heartbeat-checker.ts
│       ├── scheduler/
│       │   ├── cron-scheduler.ts
│       │   └── task-queue.ts
│       ├── event-listener/
│       │   └── event-source.ts
│       ├── notification/
│       │   └── notification-dispatcher.ts
│       └── index.ts
├── service-connectors/            (新增)
│   └── src/
│       ├── connector/
│       │   ├── service-connector.ts (SPI)
│       │   ├── email/
│       │   ├── calendar/
│       │   ├── file-storage/
│       │   ├── web-search/
│       │   └── web-browser/
│       └── index.ts
```

---

## 6. 优先级与路线图

### 6.1 三阶段路线图

```
Phase A (基础能力，4-6 周)
├── IM Gateway: Telegram + Discord + Web Chat
├── Conversation Manager: 会话路由 + 上下文压缩
├── Service Connectors: Web 搜索 + 浏览器
├── 集成测试: 用户通过 IM 与 Agent 对话
└── 依赖: 仅第一阶段 NeuroCore

Phase B (进阶能力，6-8 周)
├── IM Gateway: Slack + 企业微信 + 飞书
├── Proactive Engine: 心跳系统 + 定时任务 + 主动通知
├── Service Connectors: 邮件 + 日历 + 文件存储
├── Task Planner 增强: IM 进度推送 + 长时任务 Session Chain
├── Sub-Agent Delegation: 复杂任务委派 + 结果审阅
└── 依赖: Direction A (多 Agent) + Direction E (规划器)

Phase C (高级能力，8-12 周)
├── IM Gateway: WhatsApp + iMessage
├── Personal Memory: 文档知识库 + 语义搜索 + 隐私控制
├── Skill System: 技能学习 + 技能市场
├── Multi-Device: 设备注册 + 能力调用
├── 自我目标生成 + 持续学习
└── 依赖: Direction B + C + E 全部完成
```

### 6.2 MVP 验收标准

Phase A 完成后的 MVP 验收：

| # | 验收条件 |
|---|
| MV-01 | 用户通过 Telegram 发送消息，Agent 在 5 秒内响应 |
| MV-02 | 用户在 Web Chat 发起对话，在 Telegram 继续追问，上下文连贯 |
| MV-03 | 100 轮以上对话不丢失关键信息（上下文压缩有效） |
| MV-04 | Agent 可通过 Web 搜索回答实时问题 |
| MV-05 | Agent 可执行 3 步以上的工具链调用（搜索→总结→格式化） |
| MV-06 | 高风险操作（如发送邮件）自动暂停等待审批 |
| MV-07 | 所有 Agent 行为在 trace 中可追溯 |

---

## 7. 与 OpenClaw 的对比定位

| 维度 | OpenClaw | NeuroCore 个人助理 |
|---|---|---|
| **定位** | 通用 IM → AI 网关 | 认知架构驱动的个人助理 |
| **认知模型** | 无结构化认知周期 | 六模块认知架构 + Cycle Engine |
| **记忆** | Markdown 文件 (MEMORY.md) | 四层记忆 (working/episodic/semantic/procedural) |
| **规划** | 依赖 LLM 原生能力 | AutonomousPlanner + Goal Tree |
| **子 Agent** | sessions_send 消息转发 | TaskDelegation + InterAgentBus + 竞争广播 |
| **安全** | Docker 沙箱 + allowFrom | Amygdala (policy/budget/approval) + 循环检测 |
| **预测** | 无 | PredictionStore + PredictionError 闭环 |
| **技能** | 工具调用 | RL 驱动的技能学习 + 探索利用平衡 |
| **IM 平台** | 22+ 平台 | 渐进式接入（Phase A: 3 平台） |
| **部署模式** | 本地优先，Tailscale 远程 | 本地/云端灵活部署 |
| **可解释性** | 有限 | CompetitionLog + CycleTrace + selection_reasoning |

**NeuroCore 个人助理的核心差异化**：不是另一个 IM Bot 网关，而是将 NeuroCore 的认知架构能力通过 IM 通道暴露给用户。IM Gateway 是表面，认知引擎才是核心。

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| IM 平台 API 变更或封禁 | 服务中断 | Adapter SPI 解耦；每个平台独立降级；合规优先 |
| 逆向协议（微信个人号）不稳定 | 功能不可用 | 标记为 P2；优先使用官方 API 平台 |
| LLM 调用成本失控 | 经济不可持续 | Amygdala 预算门控 + model routing（简单任务用小模型） |
| 长时运行状态管理复杂 | 任务丢失 | SessionCheckpoint + Episode 持久化 + crash recovery |
| 隐私泄露（跨平台消息关联） | 安全事故 | 本地优先存储 + tenant 隔离 + 敏感信息标记 |
| 子 Agent 协调死锁 | 任务卡住 | 超时机制 + 用户可见的执行状态 + 手动干预 |
| 主动通知疲劳 | 用户关闭通知 | 通知分级（静默/提醒/紧急）+ 用户可配置过滤 |

---

## 9. FR 编号规划

个人助理需求的 FR 编号建议从 PA-01 开始，与第二阶段 FR-28~FR-61 并列：

| FR 范围 | 需求 |
|---|
| FR-PA-01 | IM Gateway（含 .1~.9 子平台） |
| FR-PA-02 | Conversation Manager |
| FR-PA-03 | Task Planner（个人助理增强） |
| FR-PA-04 | Sub-Agent Delegation（复用 Direction A） |
| FR-PA-05 | Proactive Engine |
| FR-PA-06 | Personal Memory |
| FR-PA-07 | Skill System（复用 Direction C） |
| FR-PA-08 | External Integration |
| FR-PA-09 | Safety & Alignment（复用 + 增强） |
| FR-PA-10 | Multi-Device（复用 Direction B） |
