# Forge3D Workflow Studio

[Live Demo](https://forge3d.lumixraku.org/)

A local-first demo for creating reusable 3D production workflows through a normal chat interface. DeepSeek turns requests into a versioned JSON DAG rendered on an editable Vue Flow canvas.

Chat requires a DeepSeek API key. Workflow execution remains simulated; no external 3D service is called.

![DeepSeek agent tool activity](assets/agent-thinking-tool-activity.jpg)

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Set `DEEPSEEK_API_KEY` in `.env`. `DEEPSEEK_BASE_URL` defaults to `https://api.deepseek.com` and `DEEPSEEK_MODEL` defaults to `deepseek-chat`.

The Vite app runs on `http://localhost:5173` and proxies `/api` to the Node.js API on `http://127.0.0.1:8787`.

## Verify

```bash
npm test
npm run build
```

## Features

- Chat-driven creation and revision of 3D workflows
- DeepSeek agent with validated workflow-building and parameter-update tools
- Versioned workflow JSON kept separate from Vue Flow's rendering format
- Editable infinite canvas with free positioning, selection, connections, zoom, and MiniMap
- Workflow loading, autosave, duplication, and mock execution
- Box selection, select all, and copy/paste between workflows
- Reusable Block Library for saving selected steps and inserting them into any workflow
- Share reusable blocks by link, or import and export them as portable JSON
- Conversation, workflow, and run persistence across server restarts
- Responsive desktop and mobile layouts

## Agent Tools

The DeepSeek agent can call the following validated tools to inspect and update the workflow. The UI streams a safe activity summary while a request is running, then keeps it collapsed below the final answer. It does not expose the model's private reasoning, raw tool arguments, or tool results.

| Tool call | Purpose |
| --- | --- |
| `get_workflow_structure` | View current nodes, connections, and all available stage types. |
| `build_workflow` | Create or rebuild a workflow from a complete ordered stage list. The server creates the frame, places stages, and connects compatible ports. |
| `get_workflow_parameters` | View adjustable parameters, permitted ranges, and options for current workflow nodes. |
| `update_node_parameters` | Update validated parameters on one existing node using the exact node ID returned by the structure lookup. |
| `add_workflow_stage` | Add a Retopology or Texture Model stage if it is not already present. |

## Data Model

Workflow nodes contain domain data and a canvas position:

```json
{
  "id": "texture",
  "type": "texture",
  "name": "Generate PBR Texture",
  "config": { "resolution": "2k", "pbr": true },
  "ui": { "position": { "x": 1240, "y": 120 } }
}
```

Edges use semantic ports rather than Vue Flow handle IDs:

```json
{
  "id": "model-texture",
  "source": { "nodeId": "model", "port": "model" },
  "target": { "nodeId": "texture", "port": "model" }
}
```

Runtime data is written atomically to `server/data/*.json`. Those files are ignored by Git and initialized from committed examples in `server/seed/`.

Reusable blocks are stored internally as workflow fragments using the versioned `workflow-fragment` format. They contain normalized node positions, internal edges, source provenance, and an explicit input/output interface for connections that crossed the original selection boundary. This allows a saved block to be inserted into any workflow without preserving references to nodes outside the original selection.

## API

- `GET /api/workflows`
- `GET /api/workflows/:id`
- `PUT /api/workflows/:id`
- `POST /api/workflows/:id/duplicate`
- `POST /api/workflows/:id/runs`
- `POST /api/chat`
- `GET /api/fragments`
- `GET /api/fragments/:idOrShareId`
- `POST /api/fragments`
- `DELETE /api/fragments/:id`

`POST /api/chat` always uses DeepSeek and returns a complete workflow definition. If `DEEPSEEK_API_KEY` is missing, it returns `503` rather than a generated mock response.

`POST /api/workflows/:id/runs` remains a simulated execution endpoint.
