# Meshy Agent 左侧交互 SSE 协议笔记

> 来源：使用 Chrome DevTools MCP 在 2026-07-24 对指定 Meshy Agent 页面进行的实际网络抓取。
>
> 说明：标记为“已验证”的内容来自实际请求或响应。标记为“推断示例”的字段结构用于说明前端实现方式，并非已验证的 Meshy API 契约。

## 结论

Meshy 左侧 Agent 使用 **SSE（Server-Sent Events）响应流**，但连接通过 `fetch()` 发起的 **POST 请求**建立，而不是传统的 `new EventSource()` GET 请求。

- 请求头：`Accept: text/event-stream`
- 响应头：`Content-Type: text/event-stream`
- SSE 帧：使用 `data: {JSON}` 与 `id: {event-id}`
- SSE 协议类型：正常业务帧使用 `event: message`，失败帧使用 `event: error`
- 业务事件类型：由 JSON 内的 `data.type` 字段表示
- 本项目普通文本：一个完整 JSON `text` 事件承载一条消息，避免增量帧丢失导致内容不完整
- 交互卡片：模型工具调用，前端根据 `tool_name` 渲染专用组件
- 普通表格：最可能通过 Markdown 文本渲染；未在本次抓包中发现专用表格事件

## 1. 请求方式

### 已验证：用户回答卡片后继续 Agent 流程

```http
POST https://api.meshy.ai/web/v4/agent/threads/{thread_id}/continue
Accept: text/event-stream
Content-Type: text/plain;charset=UTF-8
Authorization: Bearer {token}
```

实际抓取到的响应头：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
```

因此这是“POST 请求，SSE 响应”的流式模式。前端一般应使用 `fetch()` + `ReadableStream` 消费响应体。

## 2. SSE 帧格式

每个 SSE 事件以空行结束：

```text
event: message
data: {"type":"text","id":"msg_001","text":"你好"}
id: 1001-0

```

各字段含义：

| 字段 | 层级 | 用途 |
| --- | --- | --- |
| `data:` | SSE 协议 | 事件负载。本页面中为 JSON 字符串。 |
| `id:` | SSE 协议 | 流事件 ID，可用于断线重连定位。 |
| `data.id` | 业务协议 | 通常为具体文本消息 ID。 |
| `data.type` | 业务协议 | 决定前端如何处理和渲染该事件。 |

重要区别：SSE 外层的 `id:` 与 JSON 内的 `id` 不同，前者是传输事件 ID，后者是业务消息 ID。

## 3. 事件公共字段

已观察到的业务字段：

```ts
type AgentEvent = {
  type: string;
  thread_id: string;
  turn_id: string;
  step_id?: string;
  id?: string;
  tool_call_id?: string;
};
```

| 字段 | 含义 |
| --- | --- |
| `thread_id` | 整个聊天会话。 |
| `turn_id` | 当前一轮用户与 Agent 的交互。 |
| `step_id` | 当前轮次中的模型步骤或工具执行步骤。 |
| `id` | 文本消息 ID。多个增量事件使用同一个 ID。 |
| `tool_call_id` | 某次工具调用 ID；提交卡片回答时必须带回。 |

## 4. 如何显示文字

### 本项目：完整文字消息

一条最终文字消息由单个 `text` 事件承载：

```text
event: message
data: {"type":"text","thread_id":"thread_001","turn_id":"turn_001","step_id":"step_text_001","id":"msg_001","text":"这是一个可打印的 3D 模型。"}
id: 1000-0

event: message
data: {"type":"finish","thread_id":"thread_001","turn_id":"turn_001","finish_reason":"stop"}
id: 1001-0

```

前端将 `text` 直接写入同一 `id` 的消息。

### 前端处理示例

```ts
const messages = new Map<string, { content: string }>();

function handleEvent(event: AgentEvent & { text?: string }) {
  switch (event.type) {
    case "text":
      messages.set(event.id!, { content: event.text ?? "" });
      break;

    case "finish":
      // 当前 turn 结束，关闭 Thinking / Stop 等进行中状态。
      break;
  }
}
```

## 5. 如何显示卡片

### 已验证：卡片属于 `ask_user` 工具

页面展示的多选问答卡片并非普通文本或 Markdown。它由名为 `ask_user` 的工具调用驱动。

页面中实际呈现的卡片具有：

- 问题标题
- 当前问题页码，例如 `1 / 2`
- 含标题和说明的选项按钮
- `Other` 按钮
- `Skip` 和 `Next` 按钮

前端根据 `tool_name === "ask_user"` 渲染专用的问答卡片组件，而不是把工具参数直接显示给用户。

### 推断示例：工具输入事件

未捕获到初次下发卡片的原始帧；下方结构根据实际 UI 和回传格式还原，用于说明实现方式：

```text
data: {
  "type": "tool-input-available",
  "thread_id": "thread_001",
  "turn_id": "turn_001",
  "step_id": "step_tool_001",
  "tool_call_id": "toolu_001",
  "tool_name": "ask_user",
  "input": {
    "questions": [
      {
        "question": "3D 版本要多大程度保留原画？",
        "options": [
          {
            "label": "忠于原画",
            "description": "保留原始颜色、形状和有趣的比例"
          },
          {
            "label": "可爱 3D 风格",
            "description": "保留角色特征，但调整成柔和的玩具造型"
          }
        ]
      }
    ]
  }
}

```

### 前端组件映射示例

```tsx
function ToolCallRenderer({ event }: { event: any }) {
  if (event.tool_name === "ask_user") {
    return (
      <QuestionCard
        questions={event.input.questions}
        onSubmit={(answers) =>
          continueToolCall({
            turnId: event.turn_id,
            toolCallId: event.tool_call_id,
            answers,
          })
        }
      />
    );
  }

  return null;
}
```

## 6. 如何提交卡片答案

### 已验证：实际请求体

用户选择 `Cute 3D interpretation` 后，浏览器发送：

```json
{
  "turn_id": "turn_49c0d3fa-123a-44c8-ae36-7229f65a58d4",
  "tool_call_id": "toolu_018iYX7zo7okz2ysbu4v11ME",
  "idempotency_key": "tr-toolu_018iYX7zo7okz2ysbu4v11ME",
  "content": {
    "answers": {
      "0": "Cute 3D interpretation"
    }
  },
  "dismissed": false
}
```

字段说明：

| 字段 | 用途 |
| --- | --- |
| `turn_id` | 回答所属的交互轮次。 |
| `tool_call_id` | 回答所属的 `ask_user` 工具调用。 |
| `idempotency_key` | 防止前端重试导致重复提交。 |
| `content.answers` | 问题答案，key 为问题序号。 |
| `dismissed` | 是否跳过/关闭卡片。 |

多题回答的预期形态：

```json
{
  "content": {
    "answers": {
      "0": "可爱 3D 风格",
      "1": "增加打印底座"
    }
  },
  "dismissed": false
}
```

`dismissed: true` 的精确请求体未实际验证，但字段含义表明它用于 Skip 或关闭卡片。

## 7. 卡片提交后的 SSE 响应

### 已验证：`tool-output-available`

服务端会先把结构化答案作为工具输出确认，并将结果交给模型继续执行：

```text
data: {
  "type": "tool-output-available",
  "thread_id": "SoZyaT_LzfMxqXhl8WFhn",
  "turn_id": "turn_49c0d3fa-123a-44c8-ae36-7229f65a58d4",
  "step_id": "step_86386686a1f0501e3a9ac4e70c569c36",
  "tool_call_id": "toolu_018iYX7zo7okz2ysbu4v11ME",
  "tool_name": "ask_user",
  "output": {
    "success": true,
    "content": [
      {
        "type": "text",
        "text": "User responded to your questions:\n\nQ: How closely should the 3D version stick to the original drawing?\nA: Cute 3D interpretation\n"
      }
    ]
  }
}
id: 1784811942086-0

```

收到这个事件后，前端应把卡片标记为已完成或折叠为 `Answered`。接着服务端继续下发新的完整 `text` 事件。

## 8. 如何显示表格

本次抓包没有发现专用的表格工具或 `table-*` SSE 事件，因此不能确认 Meshy 有独立表格协议。

### 最可能的方式：Markdown 表格

表格作为完整 `text` 内容下发，并交由支持 GFM 的 Markdown renderer 显示：

```text
event: message
data: {"type":"text","id":"msg_table_001","text":"| 方案 | 风格 | 预计打印时间 |\n|---|---|---:|\n| A | 忠于原画 | 3 小时 |\n| B | 可爱玩具风 | 4 小时 |"}

```

拼接完成后，前端得到 Markdown：

```md
| 方案 | 风格 | 预计打印时间 |
| --- | --- | ---: |
| A | 忠于原画 | 3 小时 |
| B | 可爱玩具风 | 4 小时 |
```

显示结果：

| 方案 | 风格 | 预计打印时间 |
| --- | --- | ---: |
| A | 忠于原画 | 3 小时 |
| B | 可爱玩具风 | 4 小时 |

### 若表格需要交互

若需要排序、选择行、操作按钮等功能，合理的设计是以工具调用传输结构化数据，再按 `tool_name` 映射至 `DataTable` 组件。以下是建议实现，不是已证实的 Meshy 事件：

```json
{
  "type": "tool-input-available",
  "tool_name": "show_table",
  "input": {
    "title": "打印方案比较",
    "columns": [
      { "key": "name", "label": "方案" },
      { "key": "style", "label": "风格" },
      { "key": "hours", "label": "预计打印时间" }
    ],
    "rows": [
      { "id": "a", "name": "A", "style": "忠于原画", "hours": "3 小时" },
      { "id": "b", "name": "B", "style": "可爱玩具风", "hours": "4 小时" }
    ]
  }
}
```

## 9. 完整交互流程

```text
用户发送消息
  -> 前端向 Agent API 发起请求
  -> 服务端以 SSE 返回文本流或工具调用

文字：
  text

问答卡片：
  工具调用 ask_user
  -> 前端渲染 QuestionCard
  -> 用户选择答案
  -> POST /threads/{thread_id}/continue
  -> tool-output-available
  -> text

当前交互轮次结束：
  finish
```

## 10. 实现要点

- 每一个 SSE `data:` 是一个 JSON 事件，但不是一条完整聊天消息。
- 一条文字消息由单个完整 `text` 事件承载。
- 不要将文本消息 ID `data.id` 与 SSE 传输层事件 ID `id:` 混用。
- 卡片不要通过文本关键词识别；应由工具名，例如 `ask_user`，显式映射到前端组件。
- 卡片回传必须关联原始 `turn_id` 和 `tool_call_id`。
- `idempotency_key` 应稳定生成，避免网络重试造成多次工具继续调用。
- 普通静态表格优先复用 Markdown；只有需要交互时才设计结构化表格工具。
