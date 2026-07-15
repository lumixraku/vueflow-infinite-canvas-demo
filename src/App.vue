<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { MarkerType, VueFlow, addEdge, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import WorkflowNode from './components/WorkflowNode.vue'
import { layoutWorkflow } from './workflow-layout.js'

const ModelEditor = defineAsyncComponent(() => import('./components/ModelEditor.vue'))

const nodePresentation = {
  'reference-image': ['INPUT', 'Reference source', 'cyan'],
  prompt: ['PROMPT', 'Creative direction', 'violet'],
  'generate-image': ['IMAGE', 'Concept generation', 'amber'],
  'generate-model': ['3D MODEL', 'Image to 3D', 'green'],
  retopology: ['MESH', 'Geometry optimization', 'rose'],
  texture: ['MATERIAL', 'PBR texture set', 'violet'],
  'model-preview': ['REVIEW', 'Interactive preview', 'cyan'],
  'save-asset': ['LIBRARY', 'Reusable asset', 'green'],
  'export-model': ['OUTPUT', 'Production delivery', 'amber'],
}

const nodeConfigDefaults = {
  'reference-image': { sourceType: 'Upload', reference: '', background: 'Keep', preview: '/shark-reference.png' },
  prompt: { prompt: 'Production-ready stylized 3D asset', strength: 80 },
  'generate-image': { model: 'GPT Image 2', count: 4, aspectRatio: '1:1', referenceMode: 'Image + Prompt', previews: ['/shark-concept-front.png', '/shark-concept-left.png', '/shark-concept-right.png', '/shark-concept-back.png'] },
  'generate-model': { modelVersion: 'Smart Mesh', textureMode: 'PBR', faceType: 'Triangle', faceCount: 20000, preview: '/shark-model.png' },
  retopology: { modelVersion: 'v2.0', faceType: 'Triangle', faceLimit: 10000, bakeTextures: true, preview: '/shark-retopology.png' },
  texture: { model: 'Texture v2.0', resolution: '2K', style: 'Original', pbr: true, preview: '/shark-textured.png' },
  'model-preview': { environment: 'Studio', background: '#202322', autoRotate: true, wireframe: false, preview: '/shark-review.png' },
  'save-asset': { collection: 'Current project', tags: '', savePreview: true },
  'export-model': { format: 'glb', compression: 'Draco', includeTextures: true },
}

const workflows = ref([])
const fragments = ref([])
const sidebarMode = ref('workflows')
const activeWorkflow = ref(null)
const conversation = ref(null)
const nodes = ref([])
const edges = ref([])
const prompt = ref('')
const busy = ref(false)
const saving = ref(false)
const savedState = ref('Saved')
const run = ref(null)
const error = ref('')
const selectedCount = ref(0)
const clipboardFragment = ref(null)
const importInput = ref(null)
const theme = ref(localStorage.getItem('forge3d-theme') || 'system')
const workspaceMode = ref('workflow')
const modelEditorNodeId = ref(null)
const imagePreview = ref(null)
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
let saveTimer
let hydrating = false

const { fitView, getSelectedNodes, zoomIn, zoomOut } = useVueFlow()
const edgeDefaults = { markerEnd: MarkerType.ArrowClosed, style: { strokeWidth: 1.6 } }
const messages = computed(() => conversation.value?.messages || [])
const runSummary = computed(() => run.value ? `${Object.keys(run.value.nodeRuns).length} steps · ${run.value.status}` : 'Ready to run')
const hasSelection = computed(() => selectedCount.value > 0)
const panOnDrag = window.matchMedia('(pointer: coarse)').matches
const resolvedTheme = computed(() => theme.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : theme.value)
const modelEditorNode = computed(() => nodes.value.find((node) => node.id === modelEditorNodeId.value) || null)
const defaultModelEditorNode = computed(() => {
  const modelTypes = ['model-preview', 'texture', 'retopology', 'generate-model']
  return modelTypes.map((type) => nodes.value.find((node) => node.data.workflowType === type)).find(Boolean) || null
})

function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme.value
  document.documentElement.style.colorScheme = resolvedTheme.value
}

function setTheme(value) {
  theme.value = value
  localStorage.setItem('forge3d-theme', value)
  applyTheme()
}

function handleSystemThemeChange() {
  if (theme.value === 'system') applyTheme()
}

function toCanvas(workflow) {
  hydrating = true
  selectedCount.value = 0
  const positions = new Map(workflow.nodes.map((node) => [node.id, node.ui.position]))
  nodes.value = workflow.nodes.map((node) => {
    const [kind, detail, tone] = nodePresentation[node.type] || ['STEP', node.type, 'cyan']
    return {
      id: node.id,
      type: 'workflow',
      position: positions.get(node.id),
      data: { kind, label: node.name, detail, tone, status: 'ready', workflowType: node.type, config: normalizeNodeConfig(node.type, node.config) },
    }
  })
  edges.value = workflow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source.nodeId,
    target: edge.target.nodeId,
    sourcePort: edge.source.port,
    targetPort: edge.target.port,
    ...edgeDefaults,
  }))
  nextTick(() => { hydrating = false })
}

function normalizeNodeConfig(type, config = {}) {
  const normalized = { ...nodeConfigDefaults[type], ...config }
  if (type === 'generate-image' && Array.isArray(normalized.previews) && !normalized.previews.includes(normalized.selectedPreview)) normalized.selectedPreview = normalized.previews[0] || null
  if (type === 'generate-model') {
    if (config.quality && !config.modelVersion) normalized.modelVersion = config.quality === 'standard' ? 'Smart Mesh' : config.quality
    if (typeof config.texture === 'boolean' && !config.textureMode) normalized.textureMode = config.texture ? 'PBR' : 'None'
  }
  if (type === 'retopology' && config.targetFaces && !config.faceLimit) normalized.faceLimit = config.targetFaces
  if (type === 'texture' && typeof config.resolution === 'string') normalized.resolution = config.resolution.toUpperCase()
  if (type === 'model-preview' && config.viewer === 'turntable' && config.autoRotate === undefined) normalized.autoRotate = true
  return normalized
}

function fromCanvas() {
  if (!activeWorkflow.value) return null
  const nodeMap = new Map(activeWorkflow.value.nodes.map((node) => [node.id, node]))
  return {
    ...activeWorkflow.value,
    nodes: nodes.value.map((node) => ({ ...nodeMap.get(node.id), id: node.id, name: node.data.label, type: node.data.workflowType, config: node.data.config, ui: { position: node.position } })),
    edges: edges.value.map((edge) => ({
      id: edge.id,
      source: { nodeId: edge.source, port: edge.sourcePort || 'output' },
      target: { nodeId: edge.target, port: edge.targetPort || 'input' },
    })),
  }
}

async function request(url, options) {
  const response = await fetch(url, options)
  const data = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(data.error || 'Request failed')
  return data
}

async function loadWorkflows(preferredId) {
  await Promise.all([loadWorkflowList(), loadFragments()])
  const id = preferredId || activeWorkflow.value?.id || workflows.value[0]?.id
  if (id) await openWorkflow(id)
}

async function openWorkflow(id) {
  error.value = ''
  imagePreview.value = null
  workspaceMode.value = 'workflow'
  modelEditorNodeId.value = null
  const data = await request(`/api/workflows/${id}`)
  activeWorkflow.value = data.workflow
  conversation.value = data.conversation
  run.value = null
  toCanvas(data.workflow)
  await nextTick()
  fitView({ padding: 0.18, duration: 500 })
}

async function sendMessage() {
  const message = prompt.value.trim()
  if (!message || busy.value) return
  let shouldSaveLayout = false
  busy.value = true
  error.value = ''
  prompt.value = ''
  try {
    const data = await request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, workflowId: activeWorkflow.value?.id }),
    })
    activeWorkflow.value = data.workflow
    conversation.value = data.conversation
    toCanvas(data.workflow)
    await loadWorkflowList()
    await nextTick()
    await autoLayout({ persist: false })
    shouldSaveLayout = true
  } catch (caught) {
    error.value = caught.message
    prompt.value = message
  } finally {
    busy.value = false
  }
  if (shouldSaveLayout) scheduleSave()
}

async function loadWorkflowList() {
  workflows.value = await request('/api/workflows')
}

async function loadFragments() {
  fragments.value = await request('/api/fragments')
}

function scheduleSave() {
  if (!activeWorkflow.value || busy.value || hydrating) return
  savedState.value = 'Unsaved changes'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveWorkflow, 700)
}

async function saveWorkflow() {
  const workflow = fromCanvas()
  if (!workflow || saving.value) return
  saving.value = true
  savedState.value = 'Saving…'
  try {
    activeWorkflow.value = await request(`/api/workflows/${workflow.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(workflow),
    })
    savedState.value = 'Saved'
    await loadWorkflowList()
  } catch (caught) {
    error.value = caught.message
    savedState.value = 'Save failed'
  } finally {
    saving.value = false
  }
}

async function duplicateWorkflow() {
  const workflow = await request(`/api/workflows/${activeWorkflow.value.id}/duplicate`, { method: 'POST' })
  await loadWorkflows(workflow.id)
}

async function runWorkflow() {
  busy.value = true
  error.value = ''
  try {
    await saveWorkflow()
    run.value = await request(`/api/workflows/${activeWorkflow.value.id}/runs`, { method: 'POST' })
    nodes.value = nodes.value.map((node) => ({ ...node, data: { ...node.data, status: 'done' } }))
  } catch (caught) {
    error.value = caught.message
  } finally {
    busy.value = false
  }
}

function onConnect(connection) {
  edges.value = addEdge({ ...connection, ...edgeDefaults }, edges.value)
  scheduleSave()
}

function updateNodeConfig(id, config) {
  const node = nodes.value.find((candidate) => candidate.id === id)
  if (!node) return
  node.data = { ...node.data, config }
  scheduleSave()
}

function openModelEditor(id) {
  const node = id ? nodes.value.find((candidate) => candidate.id === id) : defaultModelEditorNode.value
  if (!node) return
  modelEditorNodeId.value = node.id
  workspaceMode.value = 'model-editor'
  nextTick(() => window.scrollTo({ top: 0 }))
}

function closeModelEditor() {
  workspaceMode.value = 'workflow'
  nextTick(() => {
    window.scrollTo({ top: 0 })
    fitView({ padding: 0.18, duration: 300 })
  })
}

function openImagePreview(preview) {
  imagePreview.value = preview
}

function closeImagePreview() {
  imagePreview.value = null
}

function deleteSelected() {
  const ids = new Set(getSelectedNodes.value.map((node) => node.id))
  nodes.value = nodes.value.filter((node) => !ids.has(node.id))
  edges.value = edges.value.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target))
  scheduleSave()
}

function onSelectionChange({ nodes: selectedNodes }) {
  selectedCount.value = selectedNodes.length
}

function onElementsChange(changes) {
  if (changes.some((change) => change.type === 'remove')) scheduleSave()
}

async function autoLayout({ persist = true } = {}) {
  const positions = await layoutWorkflow(nodes.value, edges.value)
  nodes.value = nodes.value.map((node) => ({ ...node, position: positions.get(node.id) }))
  await nextTick()
  fitView({ padding: 0.18, duration: 500 })
  if (persist) scheduleSave()
}

function selectAll() {
  nodes.value = nodes.value.map((node) => ({ ...node, selected: true }))
  selectedCount.value = nodes.value.length
}

function selectedFragmentData(name = 'Untitled fragment') {
  const selected = getSelectedNodes.value
  if (!selected.length) return null
  const workflow = fromCanvas()
  const selectedIds = new Set(selected.map((node) => node.id))
  const fragmentNodes = workflow.nodes.filter((node) => selectedIds.has(node.id))
  const minX = Math.min(...fragmentNodes.map((node) => node.ui.position.x))
  const minY = Math.min(...fragmentNodes.map((node) => node.ui.position.y))
  const internalEdges = workflow.edges.filter((edge) => selectedIds.has(edge.source.nodeId) && selectedIds.has(edge.target.nodeId))
  const inputs = workflow.edges
    .filter((edge) => !selectedIds.has(edge.source.nodeId) && selectedIds.has(edge.target.nodeId))
    .map((edge) => ({ nodeId: edge.target.nodeId, port: edge.target.port }))
  const outputs = workflow.edges
    .filter((edge) => selectedIds.has(edge.source.nodeId) && !selectedIds.has(edge.target.nodeId))
    .map((edge) => ({ nodeId: edge.source.nodeId, port: edge.source.port }))

  return {
    schemaVersion: '1.0',
    kind: 'workflow-fragment',
    name,
    description: `${fragmentNodes.length} reusable steps from ${workflow.name}`,
    source: { workflowId: workflow.id, workflowRevision: workflow.revision },
    nodes: fragmentNodes.map((node) => ({ ...node, ui: { position: { x: node.ui.position.x - minX, y: node.ui.position.y - minY } } })),
    edges: internalEdges,
    interface: { inputs, outputs },
  }
}

async function copySelected() {
  const fragment = selectedFragmentData('Copied selection')
  if (!fragment) return
  clipboardFragment.value = fragment
  try {
    await navigator.clipboard.writeText(JSON.stringify(fragment, null, 2))
  } catch {
    // The in-app clipboard still works when browser clipboard permission is unavailable.
  }
}

async function pasteFragment(fragment = clipboardFragment.value) {
  if (!fragment?.nodes?.length) return
  const suffix = Date.now().toString(36)
  const idMap = new Map(fragment.nodes.map((node, index) => [node.id, `${node.id}-${suffix}-${index}`]))
  const maxX = nodes.value.length ? Math.max(...nodes.value.map((node) => node.position.x)) : 0
  const offset = { x: maxX + 310, y: 120 }
  const domainNodes = fragment.nodes.map((node) => ({
    ...structuredClone(node),
    id: idMap.get(node.id),
    ui: { position: { x: node.ui.position.x + offset.x, y: node.ui.position.y + offset.y } },
  }))
  const domainEdges = fragment.edges.map((edge, index) => ({
    ...structuredClone(edge),
    id: `${edge.id}-${suffix}-${index}`,
    source: { ...edge.source, nodeId: idMap.get(edge.source.nodeId) },
    target: { ...edge.target, nodeId: idMap.get(edge.target.nodeId) },
  }))
  activeWorkflow.value = {
    ...fromCanvas(),
    nodes: [...fromCanvas().nodes, ...domainNodes],
    edges: [...fromCanvas().edges, ...domainEdges],
  }
  toCanvas(activeWorkflow.value)
  await nextTick()
  scheduleSave()
}

async function saveSelectedFragment() {
  if (!hasSelection.value) return
  const name = window.prompt('Name this workflow fragment', 'Reusable workflow fragment')?.trim()
  if (!name) return
  try {
    const fragment = await request('/api/fragments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(selectedFragmentData(name)),
    })
    clipboardFragment.value = fragment
    sidebarMode.value = 'fragments'
    await loadFragments()
  } catch (caught) {
    error.value = caught.message
  }
}

async function insertFragment(id) {
  try {
    const fragment = await request(`/api/fragments/${id}`)
    clipboardFragment.value = fragment
    await pasteFragment(fragment)
  } catch (caught) {
    error.value = caught.message
  }
}

async function shareFragment(fragment) {
  const url = `${location.origin}${location.pathname}?fragment=${fragment.shareId}`
  try {
    await navigator.clipboard.writeText(url)
    savedState.value = 'Share link copied'
  } catch {
    window.prompt('Copy this share link', url)
  }
}

async function exportFragment(fragment) {
  const fullFragment = await request(`/api/fragments/${fragment.id}`)
  const blob = new Blob([`${JSON.stringify(fullFragment, null, 2)}\n`], { type: 'application/json' })
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = `${fullFragment.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.workflow-fragment.json`
  anchor.click()
  URL.revokeObjectURL(anchor.href)
}

async function importFragment(event) {
  const [file] = event.target.files
  event.target.value = ''
  if (!file) return
  try {
    const input = JSON.parse(await file.text())
    const fragment = await request('/api/fragments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, id: undefined, shareId: undefined, createdAt: undefined }),
    })
    sidebarMode.value = 'fragments'
    await loadFragments()
    clipboardFragment.value = fragment
  } catch (caught) {
    error.value = `Import failed: ${caught.message}`
  }
}

function handleKeyboard(event) {
  if (imagePreview.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeImagePreview()
    }
    return
  }
  const editing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
  if (editing) return
  const modifier = event.metaKey || event.ctrlKey
  if (modifier && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    selectAll()
  }
  if (modifier && event.key.toLowerCase() === 'c' && hasSelection.value) {
    event.preventDefault()
    copySelected()
  }
  if (modifier && event.key.toLowerCase() === 'v' && clipboardFragment.value) {
    event.preventDefault()
    pasteFragment()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeyboard)
  systemTheme.addEventListener('change', handleSystemThemeChange)
  applyTheme()
  try {
    await loadWorkflows()
    const shareId = new URLSearchParams(location.search).get('fragment')
    if (shareId) {
      sidebarMode.value = 'fragments'
      clipboardFragment.value = await request(`/api/fragments/${shareId}`)
      savedState.value = `Shared fragment ready: ${clipboardFragment.value.name}`
    }
  } catch (caught) {
    error.value = caught.message
  }
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyboard)
  systemTheme.removeEventListener('change', handleSystemThemeChange)
})
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <span class="brand-mark">F3</span>
        <div><strong>Forge3D</strong><small>Conversational workflow studio</small></div>
      </div>
      <div v-if="activeWorkflow" class="workflow-title">
        <span>{{ workspaceMode === 'workflow' ? 'WORKFLOW' : 'MODEL EDITOR' }} / {{ activeWorkflow.revision.toString().padStart(2, '0') }}</span>
        <strong>{{ activeWorkflow.name }}</strong>
      </div>
      <div class="topbar-actions">
        <div class="workspace-switcher" aria-label="Workspace">
          <button :class="{ active: workspaceMode === 'workflow' }" :aria-pressed="workspaceMode === 'workflow'" @click="closeModelEditor">Workflow</button>
          <button :class="{ active: workspaceMode === 'model-editor' }" :aria-pressed="workspaceMode === 'model-editor'" :disabled="!defaultModelEditorNode" @click="openModelEditor()">Model Editor</button>
        </div>
        <div class="theme-switcher" aria-label="Theme">
          <button v-for="option in ['light', 'dark', 'system']" :key="option" :class="{ active: theme === option }" :aria-pressed="theme === option" @click="setTheme(option)">{{ option }}</button>
        </div>
        <span class="save-state">{{ savedState }}</span>
        <button class="button secondary" :disabled="!activeWorkflow" @click="duplicateWorkflow">Duplicate</button>
        <button class="button primary" :disabled="busy || !activeWorkflow" @click="runWorkflow">{{ busy ? 'Working…' : 'Run workflow' }}</button>
      </div>
    </header>

    <section v-if="workspaceMode === 'workflow'" class="workspace">
      <aside class="sidebar">
        <div class="sidebar-tabs"><button :class="{ active: sidebarMode === 'workflows' }" @click="sidebarMode = 'workflows'">Workflows</button><button :class="{ active: sidebarMode === 'fragments' }" @click="sidebarMode = 'fragments'">Fragments</button></div>
        <template v-if="sidebarMode === 'workflows'">
          <div class="sidebar-heading"><span>WORKFLOWS</span><b>{{ workflows.length }}</b></div>
          <button v-for="workflow in workflows" :key="workflow.id" class="workflow-list-item" :class="{ active: activeWorkflow?.id === workflow.id }" @click="openWorkflow(workflow.id)">
            <span>{{ workflow.name }}</span><small>{{ workflow.nodeCount }} nodes · v{{ workflow.revision }}</small>
          </button>
        </template>
        <template v-else>
          <div class="sidebar-heading"><span>SAVED FRAGMENTS</span><b>{{ fragments.length }}</b></div>
          <article v-for="fragment in fragments" :key="fragment.id" class="fragment-list-item">
            <button @click="insertFragment(fragment.id)"><span>{{ fragment.name }}</span><small>{{ fragment.nodeCount }} nodes · click to insert</small></button>
            <div><button title="Copy share link" @click="shareFragment(fragment)">Share</button><button title="Export JSON" @click="exportFragment(fragment)">JSON</button></div>
          </article>
          <button class="import-button" @click="importInput.click()">Import fragment JSON</button>
          <input ref="importInput" class="file-input" type="file" accept="application/json,.json" @change="importFragment" />
        </template>
        <div class="sidebar-note"><span>LOCAL WORKSPACE</span><p>Definitions, conversations, and mock runs persist as JSON on this machine.</p></div>
      </aside>

      <section class="chat-panel">
        <header><div><span>WORKFLOW COPILOT</span><b>Rule-based mock planner</b></div><i /></header>
        <div class="message-list">
          <article v-for="message in messages" :key="message.id" class="message" :class="message.role">
            <span>{{ message.role === 'assistant' ? 'FORGE' : 'YOU' }}</span><p>{{ message.content }}</p>
          </article>
          <article v-if="busy" class="message assistant pending"><span>FORGE</span><p>Updating the workflow definition…</p></article>
        </div>
        <p v-if="error" class="error-message">{{ error }}</p>
        <form class="composer" @submit.prevent="sendMessage">
          <textarea v-model="prompt" rows="3" placeholder="Describe a 3D workflow or ask for a change…" @keydown.meta.enter.prevent="sendMessage" @keydown.ctrl.enter.prevent="sendMessage" />
          <div><span>⌘ ENTER TO SEND</span><button :disabled="busy || !prompt.trim()">Send ↗</button></div>
        </form>
      </section>

      <section class="canvas-panel">
        <div class="canvas-toolbar">
          <div><span>CANVAS</span><b>{{ nodes.length }} nodes · {{ edges.length }} connections · {{ selectedCount }} selected</b></div>
          <div><button @click="selectAll">Select all</button><button :disabled="!hasSelection" @click="copySelected">Copy</button><button :disabled="!clipboardFragment" @click="pasteFragment()">Paste</button><button :disabled="!hasSelection" @click="saveSelectedFragment">Save fragment</button><button @click="zoomOut">−</button><button @click="zoomIn">+</button><button @click="fitView({ padding: .18, duration: 400 })">Fit</button><button :disabled="busy || saving || !nodes.length" @click="autoLayout">Auto layout</button><button :disabled="!hasSelection" @click="deleteSelected">Delete</button></div>
        </div>
        <VueFlow v-model:nodes="nodes" v-model:edges="edges" class="flow-canvas" :default-edge-options="edgeDefaults" :min-zoom=".08" :max-zoom="3.5" :snap-to-grid="false" :pan-on-scroll="true" :pan-on-drag="panOnDrag" :selection-key-code="true" :multi-selection-key-code="'Shift'" fit-view-on-init @connect="onConnect" @node-drag-stop="scheduleSave" @nodes-change="onElementsChange" @edges-change="onElementsChange" @selection-change="onSelectionChange">
          <template #node-workflow="props"><WorkflowNode v-bind="props" @update-config="updateNodeConfig(props.id, $event)" @open-model-editor="openModelEditor(props.id)" @preview-image="openImagePreview" /></template>
          <Background :gap="24" :size="1.2" :pattern-color="resolvedTheme === 'dark' ? '#252b2c' : '#cdd2cf'" />
          <MiniMap pannable zoomable :node-stroke-width="3" :mask-color="resolvedTheme === 'dark' ? 'rgba(10, 12, 12, .7)' : 'rgba(238, 241, 238, .72)'" />
          <Controls position="bottom-right" />
          <div class="canvas-caption"><span>WORKFLOW DEFINITION</span><p>{{ activeWorkflow?.description }}</p></div>
        </VueFlow>
        <footer><span><i /> {{ runSummary }}</span><span>Drag empty space to box-select · Shift to extend · ⌘A/C/V supported</span></footer>
      </section>
    </section>
    <ModelEditor v-else-if="modelEditorNode" :node="modelEditorNode" @back="closeModelEditor" @update-config="updateNodeConfig(modelEditorNode.id, $event)" />
    <Teleport to="body">
      <div v-if="imagePreview" class="image-preview-backdrop" role="dialog" aria-modal="true" :aria-label="imagePreview.alt" @click.self="closeImagePreview">
        <button type="button" class="image-preview-close" aria-label="Close image preview" @click="closeImagePreview">×</button>
        <img class="image-preview-image" :src="imagePreview.src" :alt="imagePreview.alt" />
      </div>
    </Teleport>
  </main>
</template>
