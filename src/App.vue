<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { MarkerType, VueFlow, addEdge, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import WorkflowNode from './components/WorkflowNode.vue'

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
let saveTimer
let hydrating = false

const { fitView, getSelectedNodes, zoomIn, zoomOut } = useVueFlow()
const edgeDefaults = { markerEnd: MarkerType.ArrowClosed, style: { strokeWidth: 1.6 } }
const messages = computed(() => conversation.value?.messages || [])
const runSummary = computed(() => run.value ? `${Object.keys(run.value.nodeRuns).length} steps · ${run.value.status}` : 'Ready to run')
const hasSelection = computed(() => selectedCount.value > 0)
const panOnDrag = window.matchMedia('(pointer: coarse)').matches

function toCanvas(workflow) {
  hydrating = true
  selectedCount.value = 0
  const positions = compactGeneratedLayout(workflow.nodes)
  nodes.value = workflow.nodes.map((node) => {
    const [kind, detail, tone] = nodePresentation[node.type] || ['STEP', node.type, 'cyan']
    return {
      id: node.id,
      type: 'workflow',
      position: positions.get(node.id),
      data: { kind, label: node.name, detail, meta: summarizeConfig(node.config), tone, status: 'ready', workflowType: node.type },
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

function compactGeneratedLayout(workflowNodes) {
  const positions = new Map(workflowNodes.map((node) => [node.id, node.ui.position]))
  const ys = workflowNodes.map((node) => node.ui.position.y)
  const xs = workflowNodes.map((node) => node.ui.position.x)
  const isLongSingleRow = workflowNodes.length > 5 && Math.max(...ys) - Math.min(...ys) < 40 && Math.max(...xs) - Math.min(...xs) > 1400
  if (!isLongSingleRow) return positions

  const columns = 4
  workflowNodes.forEach((node, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    positions.set(node.id, {
      x: (row % 2 ? columns - column - 1 : column) * 310,
      y: 120 + row * 220,
    })
  })
  return positions
}

function summarizeConfig(config) {
  const entry = Object.entries(config || {})[0]
  if (!entry) return 'Default configuration'
  return `${entry[0]}: ${typeof entry[1] === 'boolean' ? (entry[1] ? 'on' : 'off') : entry[1]}`
}

function fromCanvas() {
  if (!activeWorkflow.value) return null
  const nodeMap = new Map(activeWorkflow.value.nodes.map((node) => [node.id, node]))
  return {
    ...activeWorkflow.value,
    nodes: nodes.value.map((node) => ({ ...nodeMap.get(node.id), id: node.id, name: node.data.label, type: node.data.workflowType, ui: { position: node.position } })),
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
    fitView({ padding: 0.18, duration: 600 })
  } catch (caught) {
    error.value = caught.message
    prompt.value = message
  } finally {
    busy.value = false
  }
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
onUnmounted(() => window.removeEventListener('keydown', handleKeyboard))
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <span class="brand-mark">F3</span>
        <div><strong>Forge3D</strong><small>Conversational workflow studio</small></div>
      </div>
      <div v-if="activeWorkflow" class="workflow-title">
        <span>WORKFLOW / {{ activeWorkflow.revision.toString().padStart(2, '0') }}</span>
        <strong>{{ activeWorkflow.name }}</strong>
      </div>
      <div class="topbar-actions">
        <span class="save-state">{{ savedState }}</span>
        <button class="button secondary" :disabled="!activeWorkflow" @click="duplicateWorkflow">Duplicate</button>
        <button class="button primary" :disabled="busy || !activeWorkflow" @click="runWorkflow">{{ busy ? 'Working…' : 'Run workflow' }}</button>
      </div>
    </header>

    <section class="workspace">
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
          <div><button @click="selectAll">Select all</button><button :disabled="!hasSelection" @click="copySelected">Copy</button><button :disabled="!clipboardFragment" @click="pasteFragment()">Paste</button><button :disabled="!hasSelection" @click="saveSelectedFragment">Save fragment</button><button @click="zoomOut">−</button><button @click="zoomIn">+</button><button @click="fitView({ padding: .18, duration: 400 })">Fit</button><button :disabled="!hasSelection" @click="deleteSelected">Delete</button></div>
        </div>
        <VueFlow v-model:nodes="nodes" v-model:edges="edges" class="flow-canvas" :default-edge-options="edgeDefaults" :min-zoom=".08" :max-zoom="3.5" :snap-to-grid="false" :pan-on-scroll="true" :pan-on-drag="panOnDrag" :selection-key-code="true" :multi-selection-key-code="'Shift'" fit-view-on-init @connect="onConnect" @node-drag-stop="scheduleSave" @nodes-change="onElementsChange" @edges-change="onElementsChange" @selection-change="onSelectionChange">
          <template #node-workflow="props"><WorkflowNode v-bind="props" /></template>
          <Background :gap="24" :size="1.2" pattern-color="#252b2c" />
          <MiniMap pannable zoomable :node-stroke-width="3" mask-color="rgba(10, 12, 12, .7)" />
          <Controls position="bottom-right" />
          <div class="canvas-caption"><span>WORKFLOW DEFINITION</span><p>{{ activeWorkflow?.description }}</p></div>
        </VueFlow>
        <footer><span><i /> {{ runSummary }}</span><span>Drag empty space to box-select · Shift to extend · ⌘A/C/V supported</span></footer>
      </section>
    </section>
  </main>
</template>
