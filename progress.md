# Progress

## Current Status

- Branch: `feat/workflow-fragments`
- Frontend: `http://localhost:5176/`
- Backend: `http://127.0.0.1:8787/`
- Latest pushed commits:
  - `102eb6c feat: add model editor workspace`
  - `15ed5e0 fix: allow canvas scrolling over nodes`
- Current changes are not committed.

## Completed

- Implemented Chat + Canvas workflow generation with a rule-based planner, JSON DAG persistence, autosave, workflow duplication, and mock runs.
- Implemented reusable workflow fragments with validation, library insertion and deletion, share links, JSON import/export, and API support.
- Added canvas selection, copy, paste, delete, keyboard shortcuts, target gestures, and `light`, `dark`, and `system` themes.
- Added nine configurable workflow node types:
  - `reference-image`
  - `prompt`
  - `generate-image`
  - `generate-model`
  - `retopology`
  - `texture`
  - `model-preview`
  - `save-asset`
  - `export-model`
- Added separate Workflow Canvas and Model Editor workspaces with a persistent top-bar switcher.
- Added stage-aware Model Editor entry points and automatic selection of the most downstream editable node.
- Integrated the real model at `public/models/shark-gardener.glb` using `@google/model-viewer` with lazy loading.
- Added staged gardening-shark preview assets under `public/`.
- Added clickable image outputs, persistent generated-image candidate selection, full-screen image previews, and `Escape`/backdrop/close-button dismissal.
- Restored canvas wheel and trackpad panning while the pointer is over node parameter controls.
- Added 700 ms debounced persistence for node configuration, candidate selection, and Model Editor configuration.
- Fixed top-bar layout shifting caused by variable-length save status text.
- Standardized workspace switcher, theme switcher, and action controls to a 36 px outer height.
- Added fixed-width, right-aligned, ellipsized rendering for save and share status messages.
- Replaced the serpentine generated-node arrangement with an ELK layered left-to-right layout.
- Added an `Auto layout` canvas action that repositions nodes, fits the viewport, and persists the result.
- Preserved saved manual positions when opening workflows while automatically arranging newly generated or AI-updated workflows.
- Added ELK crossing minimization, network-simplex node placement, spline routing hints, connected-component separation, and deterministic handling for invalid edges and cycles.
- Added first-class layout coverage for multiple inputs, merge/split stages, multiple outputs, and independent workflow components.
- Lazy-loaded the large ELK bundle so normal application startup remains in the main application chunk and ELK loads only when layout runs.
- Replaced the planner's forced linear topology with a semantic DAG: reference image and prompt merge at concept generation, while the final model stage branches to preview and export delivery.
- Updated the seeded and active sample workflows to use two source nodes and two sink nodes.

## Verification

- Confirmed that changing the status between `Saved`, `Saving…`, `Unsaved changes`, `Save failed`, and a long share message does not move the workspace switcher.
- Confirmed all visible top-bar controls use a 36 px height.
- Confirmed no horizontal overflow at 1100 px and expected control hiding at 900 px.
- `npm test`: 11/11 tests passed.
- `npm run build`: passed.
- `git diff --check`: passed.
- The build still reports existing third-party annotation and large chunk warnings; neither blocks the build.
- Added pure layout tests covering linear flows, multiple inputs and outputs, merge/split flows, independent components, missing endpoints, and cycles.
- Browser verification confirmed all nine nodes increase monotonically on the x-axis, their rendered centers align within 0.04 px, and no edge runs backward.
- Confirmed `Auto layout` fits the viewport, reaches `Saved`, and produces no browser console warnings or errors.
- Browser verification confirmed the active workflow has eight expected edges: `reference → concept`, `prompt → concept`, `concept → model`, `model → retopology`, `retopology → texture`, `texture → preview`, `texture → save-asset`, and `save-asset → export`.
- Confirmed ELK places both inputs in the first layer, the preview and asset-delivery branches separately, and persists the resulting positions with a successful `PUT /api/workflows/wf-stylized-character` response.

## Uncommitted Files

- `src/App.vue`
- `src/components/WorkflowNode.vue`
- `src/styles.css`
- `src/workflow-layout.js`
- `src/workflow-layout.test.js`
- `server/planner.js`
- `server/planner.test.js`
- `server/seed/workflows.json`
- `package.json`
- `package-lock.json`
- `progress.md`

## Next Steps

1. Review the complete uncommitted diff and commit and push the current changes when requested.
