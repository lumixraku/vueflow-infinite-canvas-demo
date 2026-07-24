# Agent SSE Data Design

## Overview

The Vue frontend in `src/App.vue` creates an Agent turn. `sendMessage()` calls `submitAgentTask()`, which sends `POST /api/chat`. When the request accepts `text/event-stream`, the Node server (`server/index.js`) or Cloudflare Worker (`worker.js`) returns an SSE stream.

```http
POST /api/chat
Accept: text/event-stream
Content-Type: application/json

{"message":"将导出格式改为 STL","workflowId":"wf-f514f70e"}
```

The response headers are:

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
```

Each SSE frame contains a JSON payload in `data:` and a transport event ID in `id:`. The business event type is always `data.type`; the server does not send an SSE `event:` field.

```text
data: {"type":"progress","thread_id":"conv-dba980cd","turn_id":"task-a2b2cee2","step_id":"progress-4","label":"Updating node parameters","status":"running"}
id: 8-0

```

`id:` is the transport event ID. It is not the same as the JSON `id` used by `text-*` events to identify a chat message.

## Complete Business Example: Generate Images, Then Build a Workflow

This is the intended two-turn experience. Generated Artifacts are stored directly in workflow nodes. The current implementation already emits `workflow-updated` for the frontend to fetch that authoritative workflow. `request_user_select` is the only proposed event in this example; it pauses a turn when the Agent needs a user decision.

### Turn 1: Generate Two Images

The user says: `生成两张赛博朋克鲨鱼的概念图`.

`sendMessage()` in `src/App.vue` sends:

```http
POST /api/chat
Accept: text/event-stream
Content-Type: application/json

{"message":"生成两张赛博朋克鲨鱼的概念图","workflowId":"wf-123"}
```

The application server creates `task-images-123`, opens the SSE response, then emits:

```text
data: {"type":"task-start","thread_id":"conv-123","turn_id":"task-images-123","workflow_id":"wf-123"}
id: 1-0

data: {"type":"progress","thread_id":"conv-123","turn_id":"task-images-123","step_id":"step-generate-images","label":"Generating two images","status":"running"}
id: 2-0

```

The image-generation service creates two Artifacts. The application server persists their metadata in a new `generate-image` node, persists the workflow, and emits `workflow-updated`. No separate Artifact SSE event or chat gallery is needed: the canvas node is the Artifact presentation.

```text
data: {"type":"workflow-updated","thread_id":"conv-123","turn_id":"task-images-123","workflow_id":"wf-123","changed_node_ids":["generate-image"],"structure_changed":true}
id: 3-0

```

On `workflow-updated`, `consumeAgentStream()` calls `refreshWorkflow("wf-123", "task-images-123", true)`. `refreshWorkflow()` requests `GET /api/workflows/wf-123`, updates the conversation and canvas from the persisted workflow, then runs `autoLayout()` because a node was added.

The Agent then sends its text response and completes the first turn:

```text
data: {"type":"text-start","thread_id":"conv-123","turn_id":"task-images-123","step_id":"final-response","id":"msg-images-123"}
id: 4-0

data: {"type":"text-delta","thread_id":"conv-123","turn_id":"task-images-123","step_id":"final-response","id":"msg-images-123","delta":"已生成两张赛博朋克鲨鱼概念图，并加入画布。"}
id: 5-0

data: {"type":"text-end","thread_id":"conv-123","turn_id":"task-images-123","id":"msg-images-123"}
id: 6-0

data: {"type":"finish","thread_id":"conv-123","turn_id":"task-images-123","finish_reason":"stop"}
id: 7-0

```

### Turn 2: Build a Workflow From the Images

The user then says: `用这两张图片制作一个带拓扑和贴图的 3D 工作流`.

The frontend sends another `POST /api/chat` with the same `workflowId`. The application server creates `task-workflow-123`, reads the selected image Artifacts from the persisted workflow, builds the workflow, persists it, and emits:

```text
data: {"type":"task-start","thread_id":"conv-123","turn_id":"task-workflow-123","workflow_id":"wf-123"}
id: 1-0

data: {"type":"progress","thread_id":"conv-123","turn_id":"task-workflow-123","step_id":"step-build-workflow","label":"Building 3D workflow","status":"running"}
id: 2-0

data: {"type":"workflow-updated","thread_id":"conv-123","turn_id":"task-workflow-123","workflow_id":"wf-123","changed_node_ids":["generate-model","retopology","texture"],"structure_changed":true}
id: 3-0

```

The frontend handles this second `workflow-updated` exactly as in turn 1: `consumeAgentStream()` calls `refreshWorkflow()`, which fetches the persisted workflow and redraws the canvas. The canvas now contains the image node followed by the 3D model, retopology, and UV texture nodes.

```text
data: {"type":"text-start","thread_id":"conv-123","turn_id":"task-workflow-123","step_id":"final-response","id":"msg-workflow-123"}
id: 4-0

data: {"type":"text-delta","thread_id":"conv-123","turn_id":"task-workflow-123","step_id":"final-response","id":"msg-workflow-123","delta":"已基于两张概念图创建 3D 工作流：图片输入 -> 生成模型 -> 拓扑优化 -> UV 贴图。"}
id: 5-0

data: {"type":"text-end","thread_id":"conv-123","turn_id":"task-workflow-123","id":"msg-workflow-123"}
id: 6-0

data: {"type":"finish","thread_id":"conv-123","turn_id":"task-workflow-123","finish_reason":"stop"}
id: 7-0

```

### `request_user_select`: Selection Is Exceptional

Generating an Artifact never waits for a selection by default. Once generation succeeds, the application server writes every generated Artifact into the relevant workflow node, persists the workflow, and emits `workflow-updated`. The canvas node is the single Artifact presentation.

The application server emits `request_user_select` only when it cannot perform the next requested operation without a user decision. This event is generic: it can request a model, export, overwrite, parameter, or other business choice. Valid cases are limited to:

1. The user explicitly asks to choose, compare, approve, remove, or retry generated Artifacts.
2. The next operation accepts exactly one Artifact but multiple eligible Artifacts exist, and the user has not identified one.
3. The next operation requires a user-owned value that cannot be inferred, such as an export format, destination, or overwrite confirmation.

Example: the user says `从这两张概念图中选一张继续生成 3D 模型`, but does not identify the image. The application server persists the task as `waiting_for_input`, then emits `request_user_select`. The Vue frontend renders a generic selection card from `options`.

```text
data: {"type":"request_user_select","thread_id":"conv-123","turn_id":"task-123","step_id":"select-image","request_id":"select-image-123","prompt":"选择一张概念图继续生成 3D 模型","options":[{"id":"generate-image:front","label":"正面图"},{"id":"generate-image:side","label":"侧面图"}],"min":1,"max":1}
id: 4-0

```

The browser must retain `turn_id` and `request_id` with the card. They identify the paused request and are required to continue the turn.

### 4. User Submits the Exceptional Selection

The Vue frontend sends the selected Artifact IDs to the application server. `idempotency_key` must remain stable across retries.

```http
POST /api/tasks/task-123/continue
Content-Type: application/json

{
  "turn_id": "task-123",
  "request_id": "select-image-123",
  "idempotency_key": "task-123-select-image-123",
  "content": {
    "selected_option_ids": ["generate-image:front"]
  },
  "dismissed": false
}
```

The application server validates and persists the answer, then resumes the Agent. The frontend updates the existing selection card locally after a successful continuation response; no second SSE event type is needed.

### 5. Server Updates the Canvas

The application server uses the selected option, updates the next workflow node, persists the workflow, and emits `workflow-updated`. The Vue frontend fetches the authoritative state and redraws the canvas.

```text
data: {"type":"workflow-updated","thread_id":"conv-123","turn_id":"task-123","workflow_id":"wf-123","changed_node_ids":["generate-image"],"structure_changed":false}
id: 5-0

```

After `workflow-updated`, `consumeAgentStream()` calls `refreshWorkflow("wf-123", "task-123", false)`. `refreshWorkflow()` requests `GET /api/workflows/wf-123` and replaces the local canvas state with the persisted authoritative workflow.

### 6. Agent Finishes the Turn

```text
data: {"type":"text-start","thread_id":"conv-123","turn_id":"task-123","step_id":"final-response","id":"msg-123"}
id: 8-0

data: {"type":"text-delta","thread_id":"conv-123","turn_id":"task-123","step_id":"final-response","id":"msg-123","delta":"已生成两张图片，并添加到工作流。"}
id: 9-0

data: {"type":"text-end","thread_id":"conv-123","turn_id":"task-123","id":"msg-123"}
id: 10-0

data: {"type":"finish","thread_id":"conv-123","turn_id":"task-123","finish_reason":"stop"}
id: 11-0

```

## Event Types

Every SSE `data.type` value belongs to this list. `Implemented` means the current server emits and the current Vue frontend handles it. `Proposed` means it is a contract for the Artifact-card feature and is not implemented yet.

| Type | Status | Purpose |
| --- | --- | --- |
| `task-start` | Implemented | Starts an Agent turn. |
| `progress` | Implemented | Reports user-visible execution progress. |
| `text-start` | Implemented | Starts a streamed assistant message. |
| `text-delta` | Implemented | Appends text to a streamed assistant message. |
| `text-end` | Implemented | Closes a streamed assistant message. |
| `workflow-updated` | Implemented | Invalidates local workflow state after server persistence. |
| `finish` | Implemented | Marks a successful Agent turn complete. |
| `error` | Implemented | Reports a failed Agent turn. |
| `request_user_select` | Proposed | Pauses a turn and asks the user to make a required business choice. It is not limited to Artifacts. |

### Implemented Event Details

| Type | Server emitter | Frontend receiver and action |
| --- | --- | --- |
| `task-start` | `executeAgentTask()` persists `running`, then emits it. Fields: `workflow_id`. | `consumeAgentStream()` passes it to `applyAgentEvent()`, which binds `turn_id` to the optimistic assistant message. |
| `progress` | `runDeepSeekAgent()` invokes its `onProgress` callback; `executeAgentTask()` persists the progress item, then emits it. Fields: `step_id`, `label`, `status`. | `applyAgentEvent()` appends `{ label, status }` to the pending assistant message. |
| `text-start` | `executeAgentTask()` emits it after the final assistant reply and workflow state have been persisted. Fields: `step_id`, `id`. | `applyAgentEvent()` initializes the pending assistant message for the text message identified by `id`. |
| `text-delta` | `executeAgentTask()` emits the final reply text. Fields: `step_id`, `id`, `delta`. | `applyAgentEvent()` appends `delta` to the pending assistant message with the same message `id`. |
| `text-end` | `executeAgentTask()` emits it after the final reply text. Field: `id`. | `applyAgentEvent()` marks the matching message as no longer streaming. |
| `workflow-updated` | `executeAgentTask()` first persists `workflows` and `conversations`, then emits this lightweight invalidation. Fields: `workflow_id`, `changed_node_ids`, `structure_changed`. | `consumeAgentStream()` calls `refreshWorkflow(workflow_id, turn_id, structure_changed)`. `refreshWorkflow()` calls `GET /api/workflows/:workflowId`, replaces frontend workflow/conversation state, calls `toCanvas()`, and calls `autoLayout()` only if `structure_changed` is true. |
| `finish` | `executeAgentTask()` emits it after `workflow-updated` when the Agent turn succeeds. Field: `finish_reason`. | `applyAgentEvent()` returns the completed `turn_id`; `consumeAgentStream()` clears `pending` for that assistant message. It does not request workflow data. |
| `error` | `executeAgentTask()` persists the failed task, then emits it. Field: `error`. | `applyAgentEvent()` throws the error; `sendMessage()` marks the optimistic assistant message as failed and displays the error text. |

## `request_user_select` Fields

The following fields are used only by the proposed user-selection event:

| Field | Used by | Meaning |
| --- | --- | --- |
| `request_id` | `request_user_select` | Stable ID for the paused selection request. |
| `prompt` | `request_user_select` | User-visible business question. |
| `options` | `request_user_select` | Choices the user can select. Each option has a stable `id` and display `label`. |
| `min`, `max` | `request_user_select` | Minimum and maximum number of selections. |

## Shared Fields

Every event contains these fields:

| Field | Meaning |
| --- | --- |
| `type` | One of the event types listed above. |
| `thread_id` | Conversation ID. |
| `turn_id` | Agent task ID for the current user request. |

Optional fields are event-specific:

| Field | Used by | Meaning |
| --- | --- | --- |
| `workflow_id` | `task-start`, `workflow-updated` | Workflow to synchronize. |
| `step_id` | `progress`, `text-start`, `text-delta` | Identifier for an Agent execution step. |
| `id` | `text-start`, `text-delta`, `text-end` | Assistant message ID. This is not the SSE transport `id:`. |
| `label` | `progress` | User-visible Agent activity label. |
| `status` | `progress` | Currently `running` or `complete`. |
| `delta` | `text-delta` | Text to append to the assistant message. |
| `changed_node_ids` | `workflow-updated` | Node IDs changed by the Agent turn. |
| `structure_changed` | `workflow-updated` | Whether nodes or edges changed and auto-layout is needed. |
| `finish_reason` | `finish` | Current success value: `stop`. |
| `error` | `error` | User-visible task failure message. |

## Event Order

Successful turns emit events in this order:

```text
task-start
progress x N
text-start
text-delta x N
text-end
workflow-updated
finish
```

Generated Artifacts are written to workflow nodes and become visible after `workflow-updated`; they do not have their own SSE event. Only a task blocked on one of the explicit selection conditions emits `request_user_select` instead of `finish`. After `POST /api/tasks/:taskId/continue`, the server resumes the task and emits any resulting `workflow-updated`, text events, and `finish`.

Failed turns emit:

```text
task-start
progress x N
error
```

`executeAgentTask()` sends `workflow-updated` after persistence and before `finish`. `consumeAgentStream()` receives it and calls `refreshWorkflow()` immediately. Therefore the Vue frontend refreshes the canvas as soon as the authoritative state is available, rather than waiting for the SSE response to close.

## Tool Call Boundary

DeepSeek tools, including `get_workflow_structure`, `get_workflow_parameters`, `build_workflow`, `update_node_parameters`, and `add_workflow_stage`, run only between the application server and DeepSeek.

The browser receives safe `progress` labels rather than raw tool calls or raw tool outputs. In particular, `workflow-updated` is an invalidation event, not an `update_node_parameters` payload and not a full workflow document.

## Current Limitation: User Selection Cards

The current event set does **not** support a paused user-selection card when the Agent needs a required business decision.

For example, if a user says "帮我创建两个图片", the current implementation can do the following:

```text
1. The application server asks DeepSeek to add or update workflow nodes.
2. The SSE stream emits progress labels and the final text reply.
3. The application server persists the workflow.
4. The Vue frontend receives workflow-updated and fetches the full workflow.
5. The Vue Flow canvas redraws nodes from that persisted workflow.
```

It cannot currently do the following while the Agent is running:

```text
1. Pause for a required user decision, such as an export format or overwrite confirmation.
2. Render the available choices in a selection card.
3. Send the selected option back to the paused Agent turn.
```

The reason is that the current server-side tool set only changes workflow definitions. It does not persist a paused selection request or resume a turn from a submitted selection.

## Proposed User Selection Event

The following event type is required before the Agent chat can request a structured user decision. It is proposed and **not emitted by the current implementation**.

### `request_user_select`

The application server emits this when an Agent needs a user decision before it can continue. The Vue frontend renders a generic selection card.

Example: ask the user to choose an export format.

```json
{
  "type": "request_user_select",
  "thread_id": "conv-123",
  "turn_id": "task-123",
  "step_id": "select-export-format",
  "request_id": "select-export-format-123",
  "prompt": "请选择导出格式",
  "options": [
    { "id": "glb", "label": "GLB" },
    { "id": "fbx", "label": "FBX" },
    { "id": "stl", "label": "STL" }
  ],
  "min": 1,
  "max": 2
}
```

The Vue frontend retains `turn_id` and `request_id`; both identify the paused server-side selection request.

## Example: "帮我创建两个图片"

The desired end-to-end sequence is:

```text
User
  -> Vue frontend: POST /api/chat
  -> application server: creates task and opens SSE

Application server
   -> SSE task-start
   -> DeepSeek: chooses generate_images tool
   -> image-generation service: creates two image Artifacts and returns URLs
   -> application server: creates a generate-image node containing both Artifacts
   -> application server: persists workflow and conversation
   -> SSE workflow-updated
  -> Vue frontend: GET /api/workflows/:workflowId as authoritative reconciliation
  -> SSE text-start / text-delta / text-end
  -> SSE finish
```

If the Agent needs a user choice before continuing, the sequence becomes:

```text
Application server
   -> SSE request_user_select for a required business choice
   -> Vue frontend: renders a generic selection card
   -> user selects an option and submits an answer
   -> Vue frontend: POST /api/tasks/:taskId/continue
   -> application server: validates turn_id, request_id, and idempotency_key
   -> Agent resumes and emits workflow-updated, text events, and finish
```

The `POST /api/tasks/:taskId/continue` route, task pause state, generic selection card component, Artifact persistence, image-generation tool, and `request_user_select` must be implemented before this flow is available.

## Recovery

Tasks and progress are persisted. When `openWorkflow()` in `src/App.vue` loads a workflow, it calls `restoreAgentTasks()`. `restoreAgentTasks()` queries unfinished tasks:

```http
GET /api/tasks?workflowId={workflowId}&status=queued,running
```

`restoreAgentTasks()` reconstructs pending chat messages after a reload. The live communication path remains the SSE response that `submitAgentTask()` receives from `POST /api/chat`.
