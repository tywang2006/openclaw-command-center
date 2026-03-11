# 超哥办公室 — 辅助系统开发笔记

> 最后更新: 2026-03-07
> 状态: 进行中

---

## 核心定位

**这是 OpenClaw 的辅助办公系统**，不是独立的 AI 系统。
- OpenClaw 是武器库，command-center 是它的可视化面板
- 不要自己调 LLM API 做 agent，要通过 OpenClaw Gateway
- OpenClaw 有完整功能：定时提醒、技能调用、子代理、记忆管理等
- command-center 负责：可视化展示、用户交互界面、像素办公室动画

---

## 当前架构

```
浏览器 (React + Vite + Canvas 2D)
  ├── 像素办公室 (7个像素小人 + zoom 滑块)
  ├── 右侧面板 (对话/公告/记忆/活动 tabs)
  └── 底部状态栏 (7个部门指示器)
       │
       │ WebSocket (ws://host/cmd/ws)
       ▼
Express + ws (port 5100)
  ├── chokidar 监听文件变化 → WS 推送
  ├── REST API (/api/*)
  └── gateway.js → WebSocket → OpenClaw Gateway (ws://127.0.0.1:18789) ✅
       ├── 聊天: gateway.sendAgentMessage(sessionKey, msg)
       ├── 历史: gateway.getChatHistory(sessionKey, limit)
       ├── 事件: agent streaming → 实时广播到前端
       └── Session Key = Telegram topic key (统一对话)
```

---

## 待改造: 接入 OpenClaw Gateway

### Gateway 连接信息

- **WebSocket URL**: `ws://127.0.0.1:18789`
- **认证 Token**: `(see ~/.openclaw/openclaw.json gateway.auth.token)`
- **Agent ID**: `main`
- **协议**: JSON-RPC 2.0 over WebSocket

### Gateway 通信协议

#### 1. 连接握手

```json
{
  "type": "req",
  "id": "connect",
  "method": "connect",
  "params": {
    "minProtocol": 1,
    "maxProtocol": 1,
    "client": {
      "id": "command-center",
      "version": "1.0.0",
      "platform": "linux",
      "mode": "operator",
      "displayName": "超哥办公室"
    },
    "role": "operator",
    "scopes": ["operator.admin"],
    "caps": ["tool-events"],
    "auth": {
      "token": "<REDACTED — see ~/.openclaw/openclaw.json>"
    }
  }
}
```

#### 2. 发送消息

```json
{
  "type": "req",
  "id": "req_唯一ID",
  "method": "agent",
  "params": {
    "agentId": "main",
    "sessionKey": "agent:main:main",
    "message": "消息内容",
    "attachments": [],
    "deliver": false,
    "idempotencyKey": "唯一键_时间戳"
  }
}
```

#### 3. 接收响应 (流式)

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "sessionKey": "agent:main:main",
    "requestId": "req_xxx",
    "stream": "assistant",  // assistant | thinking | tool_call | tool_result
    "chunk": {
      "type": "text",
      "text": "回复内容..."
    }
  }
}
```

#### 4. 获取历史

```json
{
  "type": "req",
  "id": "history_req",
  "method": "chat.history",
  "params": {
    "sessionKey": "agent:main:main",
    "limit": 50
  }
}
```

#### 5. 取消请求

```json
{
  "type": "req",
  "id": "cancel_req",
  "method": "agent.cancel",
  "params": {
    "sessionKey": "agent:main:main",
    "requestId": "要取消的请求ID"
  }
}
```

#### 6. 心跳

- 发送 `"ping"` 文本, 收到 `"pong"`
- 或用 WebSocket 原生 ping/pong

### 改造计划

**agent.js 改造**:
1. 删除直接调用 Kimi API 的 `callLLM()` 函数
2. 新增 `OpenClawGateway` 类，维护到 gateway 的 WebSocket 连接
3. `chat()` → 通过 gateway 发送消息到对应部门 session
4. `broadcastCommand()` → 通过 gateway 向所有部门发送命令
5. 子代理创建 → 通过 gateway 创建 OpenClaw 原生子代理

**好处**:
- 利用 OpenClaw 原生的记忆管理、定时提醒、技能系统
- 不需要自己管理 API key 和额度
- 和 Telegram/WhatsApp 通道统一

---

## 已完成功能

### 后端 (server/)

| 文件 | 功能 |
|------|------|
| `server/index.js` | Express + WebSocket 服务器, port 5100 |
| `server/watcher.js` | chokidar 监听文件变化 → WS 推送 |
| `server/routes/api.js` | REST API (部门/记忆/日志/公告/广播/子代理) |
| `server/parsers/jsonl.js` | JSONL session 文件解析 |
| `server/telegram.js` | Telegram 双向通信 (已弃用，由 OpenClaw 原生处理) |
| `server/agent.js` | AI agent 对话 (通过 OpenClaw Gateway，session key = Telegram topic) |
| `server/routes/capabilities.js` | 系统能力 API — 读取 openclaw.json + skills/ |

### 前端 (src/)

| 文件 | 功能 |
|------|------|
| `src/App.tsx` | 主布局, 4个右侧 Tab (对话/公告/记忆/活动) |
| `src/components/OfficeCanvas.tsx` | 像素办公室 Canvas 渲染 |
| `src/components/ChatPanel.tsx` | 部门对话 + 子代理管理 |
| `src/components/BulletinTab.tsx` | 全公司广播命令 + 部门回复 |
| `src/components/MemoryTab.tsx` | 部门记忆查看 |
| `src/components/ActivityTab.tsx` | 实时活动日志 |
| `src/components/StatusBar.tsx` | 底部7个部门状态指示器 |
| `src/components/Icons.tsx` | SVG 图标组件 |
| `src/components/IntegrationsTab.tsx` | 系统能力面板 (Capabilities Dashboard) |
| `src/hooks/useAgentState.ts` | WebSocket 状态管理 |
| `src/office/furnitureAssets.ts` | 32种办公家具程序化精灵 |
| `src/office/` | 像素办公室游戏引擎 (来自 pixel-agents) |

### API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/departments` | GET | 获取7个部门列表+状态 |
| `/api/departments/:id/chat` | POST | 与部门 AI 对话 |
| `/api/departments/:id/history` | GET | 获取部门对话历史 (from OpenClaw Gateway) |
| `/api/departments/:id/memory` | GET/PUT | 获取/保存部门记忆 |
| `/api/departments/:id/daily/:date?` | GET | 获取部门日志 |
| `/api/departments/:id/message` | POST | 发送消息到 Telegram |
| `/api/departments/:id/photo` | POST | 发送图片到 Telegram |
| `/api/departments/:id/subagents` | GET/POST | 列出/创建子代理 |
| `/api/departments/:id/subagents/:subId/chat` | POST | 与子代理对话 |
| `/api/departments/:id/subagents/:subId` | DELETE | 删除子代理 |
| `/api/bulletin` | GET/POST | 获取/更新公告板 |
| `/api/broadcast` | POST | 全公司广播命令 |
| `/api/requests` | GET | 获取跨部门请求 |
| `/api/activity/:topicId?` | GET | 获取活动记录 |
| `/api/system/capabilities` | GET | 系统能力总览 (channels, plugins, skills, models) |

### Telegram 集成

- **Bot Token**: `(see ~/.openclaw/openclaw.json channels.telegram.botToken)`
- **Group ID**: `(see ~/.openclaw/openclaw.json channels.telegram.groupId)`
- **Topic 映射**: config.json 中 key = topic ID, dept.id = 部门ID
- **双向通信**: 用户发消息 → AI 自动回复 → 回复发回 Telegram
- **失败提示**: API 失败时发中文错误说明到 Telegram

### 对话持久化

- 每次对话自动保存到 `departments/{deptId}/daily/{YYYY-MM-DD}.md`
- 包含时间戳、来源 (chat/broadcast/telegram)、用户消息和回复

---

## 部门配置

| Topic ID | 部门 ID | 名称 | Agent | 精灵 |
|----------|---------|------|-------|------|
| 1 | coo | 总指挥部 | COO | char_0 品红 |
| 1430 | engineering | 技术开发部 | CTO | char_1 青色 |
| 1431 | operations | 运维监控部 | SRE | char_2 黄色 |
| 1432 | research | 市场研究部 | 研究员 | char_3 绿色 |
| 1433 | product | 产品设计部 | 产品经理 | char_4 紫色 |
| 1434 | admin | 行政后勤部 | 管家 | char_5 橙色 |
| 1435 | blockchain | 区块链合约部 | 链上工程师 | char_0+hue 蓝色 |

---

## OpenClaw 配置位置

| 文件 | 内容 |
|------|------|
| `/root/.openclaw/openclaw.json` | 主配置 (API key, gateway, plugins, channels) |
| `/root/.openclaw/agents/main/agent/models.json` | 模型配置 |
| `/root/.openclaw/agents/main/agent/auth-profiles.json` | 认证配置 |
| `/root/.openclaw/workspace/departments/config.json` | 部门配置 |
| `/root/.openclaw/workspace/departments/personas/*.md` | 部门人设 |
| `/root/.openclaw/workspace/departments/*/memory/MEMORY.md` | 部门记忆 |
| `/root/.openclaw/workspace/departments/bulletin/board.md` | 公告板 |

---

## Kimi API 配置 (当前临时使用)

- **Provider**: Moonshot
- **Base URL**: `https://api.moonshot.ai/v1`
- **API Key**: `(see ~/.openclaw/openclaw.json models.providers.moonshot.apiKey)`
- **Model**: `kimi-k2.5` (256K context, 8192 max tokens)
- **注意**: temperature 只能为 1 (不能设其他值)

---

## 部署

```bash
# 项目路径
cd /root/.openclaw/workspace/command-center

# 构建
npm run build  # = tsc -b && vite build

# PM2
pm2 restart openclaw-cmd

# Nginx
# /cmd/ → 127.0.0.1:5100 (含 basic auth)
# /cmd/ws → WebSocket 升级
# /cmd/api/ → API 代理 (120s timeout)
```

---

## 已完成 (2026-03-06)

### ✅ 改造 agent.js 接入 OpenClaw Gateway
- 新增 `server/gateway.js` — GatewayClient 单例类
  - WebSocket 连接到 `ws://127.0.0.1:18789`
  - 握手参数: `clientId: "gateway-client"`, `clientMode: "backend"`, `protocol: 3`
  - 自动重连（指数退避 1s-30s）、心跳 25s
  - `sendAgentMessage(sessionKey, message)` → 等待 `res` 帧（跳过 `accepted`，解析 `completed`）
- 重构 `server/agent.js` — 删除 Kimi API 直接调用
  - 删除 `callLLM()`、`KIMI_API_KEY`/`KIMI_BASE_URL`/`KIMI_MODEL` 常量
  - 删除 `conversations` Map（Gateway 通过 sessionKey 管理对话历史）
  - `chat()` → `gateway.sendAgentMessage('agent:main:{deptId}', context + msg)`
  - `broadcastCommand()` → 循环各部门发送
  - `chatSubAgent()` → sessionKey `agent:main:{deptId}:sub:{subId}`
  - 新增 `buildDepartmentContext()` — 将 persona/memory/bulletin 作为上下文前缀
  - 所有导出函数签名不变，routes/api.js 和 telegram.js 无需改动
- 修改 `server/index.js` — Gateway 生命周期管理
  - 启动时连接 Gateway，关停时断开
  - `/health` 端点增加 gateway 状态

### ✅ 像素办公室 Zoom 滑块控件
- `src/components/OfficeCanvas.tsx` — 右下角 zoom 控件（−/slider/+ 和倍率显示）
- `src/components/OfficeCanvas.css` — 深色主题样式，accent #00d4aa

### 关键发现: Gateway 协议细节
- Gateway 返回**两个** `res` 帧: 第一个 `status: "accepted"`（确认收到），第二个 `status: "ok"` + `result.payloads[0].text`（完整回复）
- 流式事件用 `runId`（= idempotencyKey）而非 `requestId`
- 握手 `client.id`/`client.mode` 必须匹配 `~/.openclaw/devices/paired.json` 中已配对设备

---

### ✅ 子代理详情展示 + 像素办公室显示

- `ChatPanel.tsx` — 点击子代理 chip 时，显示详情栏（名字、状态、任务描述）
  - 导出 `SubAgent` 类型，新增 `onSubAgentsChange` 回调
- `App.tsx` — 提升子代理状态到 App 级别
  - `subAgentsByDept: Record<string, SubAgent[]>` 传递给 OfficeCanvas
- `OfficeCanvas.tsx` — 子代理在像素办公室中显示为独立角色
  - 通过 `OfficeState.addSubagent()` / `removeSubagent()` 同步
  - 子代理标签用绿色背景区分（部门主代理用深蓝色）
  - `subAgentNamesRef` 追踪 charId → 显示名映射
- `App.css` — 左面板 60% → 70%，右面板 40% → 30%

### ✅ 像素办公室 4×2 多房间布局 + 部门定位

- `scripts/gen-layout.js` — 布局生成器重写
  - 45×22 格子，4×2 办公室网格 + 走廊
  - 每个部门独立房间：墙壁 + 2格门 + 彩色地板
  - 家具稳定 UID：`dept-{name}-chair-main`、`dept-{name}-chair-sub{N}`
  - 每间：主桌(ASSET_7) + 电脑(ASSET_90) + 主椅 + 书架 + 植物 + 3个子代理工位
  - 大厅：自动贩卖机、饮水机、会议桌椅、植物
  - 走廊两端植物装饰
  - 87 个家具，30 个座位
- `OfficeCanvas.tsx` — 新增 `DEPT_TO_SEAT` 映射
  - 每个部门通过 `preferredSeatId` 分配到指定办公室的主椅
  - 子代理自动分配到父部门附近的空椅子
- 修复 `ASSET_26`（不存在）→ 使用 `ASSET_140-143`（有效植物资产）

---

## 已完成 (2026-03-07)

### ✅ Telegram 消息在 app 实时显示
- **发现**: OpenClaw Telegram 插件 `configured: true` 但 `running: false`，不存在双重处理冲突
- command-center 的 `telegram.js` 是唯一的 Telegram 处理器
- 前端 Activity 类型新增 `source` 和 `fromName` 字段
- ChatPanel 显示来源标签 (TG 蓝色 badge) 和发送者名字
- useAgentState 支持两种 `activity:new` 格式：单消息 (telegram) 和多消息 (watcher)

### ✅ Gateway 事件监听
- `gateway.js` 新增 `_handleEvent()`、`_handleAgentEvent()`、`onEvent()`
- 处理 `event` 类型帧：agent 流式事件、health、tick、connect.challenge
- 流式文本按 `runId` 累积，完成后通过 listeners 派发
- `index.js` 注册 Gateway 事件监听，自动将 agent 对话广播到前端 WebSocket
- 握手 caps 新增 `agent-events`、`channel-events`

### ✅ StatusBar 部门卡片高度一致
- `StatusBar.css` — `.status-bar` 从 `align-items: center` 改为 `align-items: stretch`
- 所有部门卡片高度保持一致，无论是否有 currentTask

### ✅ SubAgent 页面刷新后保持显示
- `App.tsx` — 新增 useEffect，在 departments 加载后立即获取所有部门的 subagents
- 不再需要手动选中部门才能在像素办公室看到 subagents

### ✅ Token 安全验证
- 确认所有 OpenClaw cron jobs 已禁用 (`enabled: false`)
- Idle 状态的 agent/subagent 不消耗 token
- 只有用户主动对话、Telegram 消息、定时任务（需手动启用）才触发 AI 调用

### ✅ StatusBar 底部卡片显示修复
- `StatusBar.css` — `.status-bar` 移除 `height: 56px` 固定高度，改为自动高度
- 减小 padding: `8px 12px` → `6px 10px`，gap: `8px` → `6px`
- `.dept-card` 移除 `overflow: hidden`，`border-radius: 20px` → `8px`，padding 缩小
- 解决了底部卡片内容被截断的问题

### ✅ MemoryTab 记忆编辑功能
- `MemoryTab.tsx` — 新增编辑模式：点击编辑按钮 → textarea 编辑器 → 保存/取消
- 保存调用 `PUT /cmd/api/departments/:id/memory`
- `MemoryTab.css` — 新增 `.memory-actions`、`.mem-btn`、`.memory-editor` 样式
- `routes/api.js` — 新增 PUT `/departments/:id/memory` 路由 + `saveMemory` 导入

### ✅ 像素办公室精灵品质提升
- `furnitureAssets.ts` — 扩展 COLORS 调色板（+30 新色调：木材、金属、屏幕、LED、面料等）
- 重写 8 个核心精灵生成器：
  - `generateCounterWhiteSmall` — 3D 桌面 + 抽屉 + 桌腿
  - `generateFullWoodenBookshelfSmall` — 多色书籍 + 高度/宽度变化 + 暗边
  - `generateChairCushionedRight/Left` — 靠背 + 座垫高光 + 轮子
  - `generateWhitePlant2` — 锥形花盆 + 有机叶片
  - `generateVendingMachine` — 玻璃反光 + 产品行 + 投币口 + LED + 出货口
  - `generateServer` — LED 状态灯 + 硬盘仓 + 散热孔
  - `generateFullComputerCoffeeOff` — 屏幕窗口/任务栏 + 键盘按键 + 鼠标 + 咖啡杯蒸汽

### ✅ OpenClaw Telegram 插件启用
- 修复 `openclaw.json` 配置错误：
  - Google provider: 添加 `baseUrl`，`"api": "google-ai"` → `"google-generative-ai"`
  - Telegram: `"streamMode": "partial"` → `"streaming": "partial"`
- 执行 `openclaw doctor --fix` 应用额外自动修复
- Gateway 重启后 `openclaw channels status --probe` 确认 Telegram running (mode: polling)
- 注意: Gateway health 广播仍报 `running: false`，但 CLI probe 确认正常运行

---

## 下次继续的 TODO

1. ~~**子代理显示自定义名字**~~ ✅ 已完成

2. ~~**像素办公室美化 + 多房间布局**~~ ✅ 已完成

3. ~~**Telegram 消息在 app 实时显示**~~ ✅ 已完成

4. ~~**记忆管理**~~ ✅ 已完成 — MemoryTab 支持编辑保存

5. **去掉 department context 前缀** — 如果 OpenClaw agent 的 system prompt 已有部门感知，可以简化消息

6. ~~**像素办公室外观素材**~~ ✅ 已完成 — 8个核心精灵重写 + 扩展调色板

7. ~~**启用 OpenClaw Telegram 插件**~~ ✅ 已完成 — 修复 openclaw.json 配置错误，gateway 重启后确认运行

8. **剩余精灵提升** — 仅改了 8/32 个精灵（电脑、桌子、书架、椅子、植物、自动贩卖机、服务器），其余可继续优化

9. **Telegram health 事件不一致** — Gateway health 广播 `running: false`，但 `openclaw channels status --probe` 显示 running。需调查 health 事件报告逻辑

---

## 已完成 (2026-03-09)

### ✅ 集成面板改造 → 系统能力面板 (Capabilities Dashboard)

**目标**: 用真实系统数据替换空表单集成面板，合并 SkillsTab

**后端新增**:
- `server/routes/capabilities.js` — `GET /api/system/capabilities`
  - 读取 `openclaw.json` 提取 channels, plugins, skills.entries, models
  - 扫描 `workspace/skills/` 目录获取技能列表 + SKILL.md frontmatter
  - 所有 API key/token 脱敏，只返回 `hasApiKey: boolean`
  - 返回 4 个分类: channels, plugins, skills, models

**前端重写**:
- `IntegrationsTab.tsx` — 全新 Capabilities Dashboard
  - 4 个可折叠 section: 通道、插件、技能、模型
  - 每张卡片显示真实状态 (RUNNING/STOPPED/ENABLED/DISABLED/API KEY)
  - 技能搜索 (从 SkillsTab 继承) + 点击查看 SKILL.md 详情弹窗
  - 纯只读 + "在对话中配置" CTA 按钮
- `IntegrationsTab.css` — 全新 `.cap-` 前缀样式
- `App.tsx` — 移除 SkillsTab，简化 IntegrationsTab props

**删除文件**:
- `server/routes/integrations.js` — 旧的按部门配置集成路由
- `src/components/SkillsTab.tsx` + `SkillsTab.css` — 合并到 IntegrationsTab
- `departments/integrations/*.json` — 旧的部门集成配置文件

**i18n**: 替换 `integrations.*` 键为 `cap.*` 键，tab 标签 '集成' → '能力'

### ✅ 5大功能升级: 集成配置 + Gmail + Google Drive + 语音输入 + 对话导出

**新增后端路由文件 (4个)**:

| 文件 | 功能 |
|------|------|
| `server/routes/integrations-config.js` | 集成配置 CRUD — Gmail/Drive/Voice 凭证管理 |
| `server/routes/email.js` | Gmail SMTP 发送 (Nodemailer + App Password) |
| `server/routes/drive.js` | Google Drive 备份 (googleapis + Service Account) |
| `server/routes/voice.js` | 语音转文字 (OpenAI Whisper API + multer) |

**新增 API 端点**:

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/integrations/config` | GET | 获取所有集成配置 (敏感字段脱敏) |
| `/api/integrations/config/:service` | PUT | 更新服务配置 (gmail/drive/voice) |
| `/api/integrations/config/:service/test` | POST | 测试服务连接 |
| `/api/integrations/config/:service` | DELETE | 重置服务为默认配置 |
| `/api/email/status` | GET | Gmail 配置状态 |
| `/api/email/test` | POST | 测试 Gmail 连接 |
| `/api/email/send` | POST | 发送邮件 (to, subject, body, html?, attachments?) |
| `/api/drive/status` | GET | Drive 配置状态 |
| `/api/drive/upload` | POST | 上传文件到 Drive 备份文件夹 |
| `/api/drive/backup` | POST | 备份部门记忆+日志到 Drive |
| `/api/drive/files` | GET | 列出 Drive 备份文件 |
| `/api/voice/transcribe` | POST | 语音转文字 (multipart audio) |
| `/api/departments/:id/export` | POST | 导出对话 (md/html 格式下载) |

**配置存储**: `integrations.json` (项目根目录)
```json
{
  "gmail": { "enabled": false, "email": "", "appPassword": "" },
  "drive": { "enabled": false, "serviceAccountKey": null, "folderId": null },
  "voice": { "enabled": true, "source": "openclaw", "apiKeyOverride": null }
}
```

**前端改动**:

| 文件 | 改动 |
|------|------|
| `IntegrationsTab.tsx` | +Services 配置区 (3张卡片: Gmail/Drive/Voice) + 配置弹窗 |
| `IntegrationsTab.css` | +config-form, config-modal, service-card, test-result 样式 |
| `ChatPanel.tsx` | +麦克风按钮 (MediaRecorder → Whisper), +邮件表单, +导出下拉菜单 |
| `ChatPanel.css` | +mic-btn 录音脉冲动画, +email-form, +export-menu 样式 |
| `MemoryTab.tsx` | +"保存到 Drive" 按钮 |
| `i18n/en.ts` + `zh.ts` | +~50 个 i18n 键 (integ.*, email.*, drive.*, voice.*, export.*) |

**npm 依赖**: +`nodemailer`, +`googleapis`

**技术方案**:
- Gmail: Nodemailer + Gmail App Password (16位应用专用密码)，非 OAuth2
- Google Drive: Service Account JSON Key，自动创建 "CommandCenter-Backups" 文件夹
- 语音: 浏览器 MediaRecorder API 录音 → 服务端 Whisper API 转文字 → 填入输入框
- 导出: 服务端生成 Markdown/HTML，Content-Disposition 附件下载
- Voice API Key 优先级: integrations.json override > openclaw.json `skills.entries['openai-whisper-api'].apiKey`
