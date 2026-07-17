# Forge3D Workflow Studio

A local-first demo for creating reusable 3D production workflows through a normal chat interface. The rule-based mock planner turns requests into a versioned JSON DAG rendered on an editable Vue Flow canvas.

No server, database, external LLM, or 3D service is required. Demo data is stored in the browser's LocalStorage.

![Forge3D Workflow Studio](assets/forge3d-workflow-studio.png)

## Run

```bash
npm install
npm run dev
```

The Vite app runs on `http://localhost:5173`. It can be deployed as a static site to Vercel or Cloudflare Pages with `npm run build` and the `dist` output directory.

## Verify

```bash
npm test
npm run build
```

## Features

- Chat-driven creation and revision of 3D workflows
- Deterministic planner for low-poly and PBR texture requests
- Versioned workflow JSON kept separate from Vue Flow's rendering format
- Editable infinite canvas with free positioning, selection, connections, zoom, and MiniMap
- Workflow loading, autosave, duplication, and mock execution
- Box selection, select all, copy/paste, and reusable workflow fragments
- Shareable fragment links plus portable JSON import and export
- Conversation, workflow, fragment, and run persistence across browser reloads
- Responsive desktop and mobile layouts

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

Runtime data is stored under `forge3d-demo-state-v1` in LocalStorage and initialized from the committed examples in `server/seed/`.

Workflow fragments use the versioned `workflow-fragment` format. They contain normalized node positions, internal edges, source provenance, and an explicit input/output interface for connections that crossed the original selection boundary. This makes fragments portable across workflows without preserving references to nodes outside the selection.

## Local Mock API

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

These routes are implemented by an in-browser adapter rather than a network service. `POST /api/chat` always returns a complete workflow definition, preserving the original API contract while keeping the demo fully static.
