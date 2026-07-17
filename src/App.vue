<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { MarkerType, SelectionMode, VueFlow, addEdge, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import WorkflowNode from './components/WorkflowNode.vue'
import { mergeNodeRuns } from './node-runs.js'
import { layoutWorkflow } from './workflow-layout.js'
import { canConnectNodeTypes, compatibleNodeTypes, nodeCatalog, nodeCategories, nodeDefinition, nodeDisplayName } from './workflow-nodes.js'
import { localRequest } from './local-api.js'

const ModelEditor = defineAsyncComponent(() => import('./components/ModelEditor.vue'))

const nodePresentation = {
  'reference-image': ['INPUT', 'Reference source', 'cyan'],
  prompt: ['PROMPT', 'Creative direction', 'violet'],
  'generate-image': ['IMAGE', 'Concept generation', 'amber'],
  'generate-model': ['3D MODEL', 'Image to 3D', 'green'],
  'text-to-3d': ['3D MODEL', 'Text to 3D', 'green'],
  retopology: ['MESH', 'Geometry optimization', 'rose'],
  texture: ['MATERIAL', 'PBR texture set', 'violet'],
  'model-preview': ['REVIEW', 'Interactive preview', 'cyan'],
}

const nodeConfigDefaults = {
  'reference-image': { sourceType: 'Upload', reference: '', background: 'Keep', preview: '/shark-reference.png' },
  prompt: { prompt: 'Production-ready stylized 3D asset', strength: 80 },
  'generate-image': { model: 'GPT Image 2', count: 4, aspectRatio: '1:1', referenceMode: 'Image + Prompt', previews: ['/shark-concept-front.png', '/shark-concept-left.png', '/shark-concept-right.png', '/shark-concept-back.png'] },
  'generate-model': { modelVersion: 'Smart Mesh', textureMode: 'PBR', faceType: 'Triangle', faceCount: 20000, preview: '/shark-model.png' },
  'text-to-3d': { modelVersion: 'Smart Mesh', textureMode: 'PBR', faceType: 'Triangle', faceCount: 20000, preview: '/shark-model.png' },
  retopology: { modelVersion: 'v2.0', faceType: 'Triangle', faceLimit: 10000, bakeTextures: true, preview: '/shark-retopology.png' },
  texture: { model: 'Texture v2.0', resolution: '2K', style: 'Original', pbr: true, preview: '/shark-textured.png' },
  'model-preview': { environment: 'Studio', autoRotate: true, wireframe: false, preview: '/shark-review.png' },
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
const nodeRuns = ref({})
const error = ref('')
const clipboardFragment = ref(null)
const importInput = ref(null)
const nodeMenuOpen = ref(false)
const nodeMenuContext = ref(null)
const theme = ref(localStorage.getItem('forge3d-theme') || 'system')
const workspaceMode = ref('workflow')
const modelEditorNodeId = ref(null)
const imagePreview = ref(null)
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
let saveTimer
let hydrating = false
let pendingConnection = null
let runPollToken = 0
let saveRequested = false
let savePromise = null

const { fitView, screenToFlowCoordinate, zoomIn, zoomOut } = useVueFlow()
const edgeDefaults = { selectable: true, markerEnd: MarkerType.ArrowClosed, style: { strokeWidth: 1.6 } }
const messages = computed(() => conversation.value?.messages || [])
const runSummary = computed(() => {
  if (!run.value) return 'Ready to run'
  const nodeRuns = Object.values(run.value.nodeRuns)
  const completed = nodeRuns.filter((nodeRun) => ['succeeded', 'failed'].includes(nodeRun.status)).length
  return run.value.status === 'running' ? `Running · ${completed}/${nodeRuns.length} steps` : `${nodeRuns.length} steps · ${run.value.status}`
})
const isRunning = computed(() => run.value?.status === 'running')
const selectedNodes = computed(() => nodes.value.filter((node) => node.selected))
const selectedEdges = computed(() => edges.value.filter((edge) => edge.selected))
const selectedCount = computed(() => selectedNodes.value.length + selectedEdges.value.length)
const hasSelection = computed(() => selectedCount.value > 0)
const panOnDrag = window.matchMedia('(pointer: coarse)').matches
const resolvedTheme = computed(() => theme.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : theme.value)
const modelEditorNode = computed(() => nodes.value.find((node) => node.id === modelEditorNodeId.value) || null)
const defaultModelEditorNode = computed(() => {
  const modelTypes = ['model-preview', 'texture', 'retopology', 'generate-model', 'text-to-3d']
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
  const positions = new Map(workflow.nodes.map((node) => [node.id, node.ui.position]))
  nodes.value = workflow.nodes.map((node) => {
    const [kind, detail, tone] = nodePresentation[node.type] || ['STEP', node.type, 'cyan']
    return {
      id: node.id,
      type: 'workflow',
      position: positions.get(node.id),
      data: {
        kind,
        label: nodeDisplayName(node.type, node.name),
        detail,
        tone,
        status: 'ready',
        workflowType: node.type,
        config: normalizeNodeConfig(node.type, node.config),
        inputTypes: nodeDefinition(node.type)?.inputTypes || [],
        outputType: nodeDefinition(node.type)?.outputType || null,
      },
    }
  })
  const workflowNodes = new Map(workflow.nodes.map((node) => [node.id, node]))
  edges.value = workflow.edges
    .filter((edge) => canConnectNodeTypes(workflowNodes.get(edge.source.nodeId)?.type, workflowNodes.get(edge.target.nodeId)?.type))
    .map((edge) => ({
      id: edge.id,
      source: edge.source.nodeId,
      target: edge.target.nodeId,
      sourceHandle: 'output',
      targetHandle: 'input',
      sourcePort: edge.source.port,
      targetPort: edge.target.port,
      ...edgeDefaults,
    }))
  nextTick(() => { hydrating = false })
}

function normalizeNodeConfig(type, config = {}) {
  const normalized = { ...nodeConfigDefaults[type], ...config }
  if (type === 'generate-image' && Array.isArray(normalized.previews) && !normalized.previews.includes(normalized.selectedPreview)) normalized.selectedPreview = normalized.previews[0] || null
  if (['generate-model', 'text-to-3d'].includes(type)) {
    if (config.quality && !config.modelVersion) normalized.modelVersion = config.quality === 'standard' ? 'Smart Mesh' : config.quality
    if (typeof config.texture === 'boolean' && !config.textureMode) normalized.textureMode = config.texture ? 'PBR' : 'None'
  }
  if (type === 'retopology' && config.targetFaces && !config.faceLimit) normalized.faceLimit = config.targetFaces
  if (type === 'texture' && typeof config.resolution === 'string') normalized.resolution = config.resolution.toUpperCase()
  if (type === 'model-preview' && config.viewer === 'turntable' && config.autoRotate === undefined) normalized.autoRotate = true
  if (type === 'model-preview') delete normalized.background
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
      source: { nodeId: edge.source, port: edge.sourcePort || nodeDefinition(nodes.value.find((node) => node.id === edge.source)?.data.workflowType)?.outputType || 'output' },
      target: { nodeId: edge.target, port: edge.targetPort || 'input' },
    })),
  }
}

async function request(url, options) {
  return localRequest(url, options)
}

async function loadWorkflows(preferredId) {
  await Promise.all([loadWorkflowList(), loadFragments()])
  const id = preferredId || activeWorkflow.value?.id || workflows.value[0]?.id
  if (id) await openWorkflow(id)
}

async function openWorkflow(id) {
  runPollToken += 1
  error.value = ''
  imagePreview.value = null
  workspaceMode.value = 'workflow'
  modelEditorNodeId.value = null
  const data = await request(`/api/workflows/${id}`)
  activeWorkflow.value = data.workflow
  conversation.value = data.conversation
  run.value = null
  nodeRuns.value = data.nodeRuns || {}
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
  if (saving.value) {
    saveRequested = true
    return savePromise
  }
  saving.value = true
  savedState.value = 'Saving…'
  savePromise = (async () => {
    do {
      saveRequested = false
      const workflow = fromCanvas()
      if (!workflow) return
      activeWorkflow.value = await request(`/api/workflows/${workflow.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(workflow),
      })
      await loadWorkflowList()
    } while (saveRequested)
  })()
  try {
    await savePromise
    savedState.value = 'Saved'
  } catch (caught) {
    error.value = caught.message
    savedState.value = 'Save failed'
  } finally {
    saving.value = false
    savePromise = null
  }
}

async function duplicateWorkflow() {
  const workflow = await request(`/api/workflows/${activeWorkflow.value.id}/duplicate`, { method: 'POST' })
  await loadWorkflows(workflow.id)
}

async function runWorkflow(targetNodeId) {
  if (!activeWorkflow.value || busy.value || isRunning.value) return
  busy.value = true
  error.value = ''
  const pollToken = ++runPollToken
  try {
    await saveWorkflow()
    const workflowId = activeWorkflow.value.id
    const startedRun = await request(`/api/workflows/${workflowId}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetNodeId }),
    })
    run.value = startedRun
    nodeRuns.value = targetNodeId ? mergeNodeRuns(nodeRuns.value, startedRun.nodeRuns) : startedRun.nodeRuns
    const runId = run.value.id
    busy.value = false

    while (run.value?.status === 'running' && runPollToken === pollToken) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const nextRun = await request(`/api/workflows/${workflowId}/runs/${runId}`)
      if (runPollToken !== pollToken || activeWorkflow.value?.id !== workflowId) return
      run.value = nextRun
      nodeRuns.value = targetNodeId ? mergeNodeRuns(nodeRuns.value, nextRun.nodeRuns) : nextRun.nodeRuns
    }
  } catch (caught) {
    error.value = caught.message
  } finally {
    busy.value = false
  }
}

function onConnect(connection) {
  addConnection(connection.source, connection.target)
  pendingConnection = null
}

function onConnectStart(connection) {
  pendingConnection = connection.handleType === 'source' ? { nodeId: connection.nodeId } : null
}

function isValidConnection(connection) {
  if (!connection?.source || !connection?.target || connection.source === connection.target) return false
  const source = nodes.value.find((node) => node.id === connection.source)
  const target = nodes.value.find((node) => node.id === connection.target)
  return Boolean(source && target && canConnectNodeTypes(source.data.workflowType, target.data.workflowType))
}

function addConnection(sourceId, targetId) {
  if (!isValidConnection({ source: sourceId, target: targetId })) return false
  const source = nodes.value.find((node) => node.id === sourceId)
  const target = nodes.value.find((node) => node.id === targetId)
  const exists = edges.value.some((edge) => edge.source === source.id && edge.target === target.id)
  if (exists) return false
  edges.value = addEdge({
    id: `edge-${source.id}-${target.id}-${Date.now().toString(36)}`,
    source: source.id,
    target: target.id,
    sourceHandle: 'output',
    targetHandle: 'input',
    sourcePort: source.data.outputType,
    targetPort: 'input',
    ...edgeDefaults,
  }, edges.value)
  scheduleSave()
  return true
}

function onConnectEnd(event) {
  if (!pendingConnection) {
    pendingConnection = null
    return
  }
  const pointerEvent = event?.event || event
  const point = pointerEvent?.changedTouches?.[0] || pointerEvent
  const targetElement = point ? document.elementFromPoint(point.clientX, point.clientY)?.closest('.vue-flow__node') : null
  const target = targetElement?.dataset.id
  if (target) addConnection(pendingConnection.nodeId, target)
  else if (point) openNodeMenuAt(point.clientX, point.clientY, pendingConnection.nodeId)
  pendingConnection = null
}

function onConnectCancel() {
  pendingConnection = null
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
  const nodeIds = new Set(selectedNodes.value.map((node) => node.id))
  const edgeIds = new Set(selectedEdges.value.map((edge) => edge.id))
  nodes.value = nodes.value.filter((node) => !nodeIds.has(node.id))
  edges.value = edges.value.filter((edge) =>
    !edgeIds.has(edge.id) &&
    !nodeIds.has(edge.source) &&
    !nodeIds.has(edge.target)
  )
  scheduleSave()
}

function selectEdge(edge, event) {
  const extendSelection = event.shiftKey
  nodes.value = nodes.value.map((node) => extendSelection ? node : { ...node, selected: false })
  edges.value = edges.value.map((item) => ({
    ...item,
    selected: item.id === edge.id || (extendSelection && item.selected),
  }))
}

function selectCanvasEdge(event) {
  const edgeElement = event.target.closest?.('.vue-flow__edge')
  if (!edgeElement) return
  const edge = edges.value.find((item) => item.id === edgeElement.dataset.id)
  if (edge) selectEdge(edge, event)
}

function nextNodeId(type) {
  const ids = new Set(nodes.value.map((node) => node.id))
  if (!ids.has(type)) return type
  let index = 2
  while (ids.has(`${type}-${index}`)) index += 1
  return `${type}-${index}`
}

function nodePosition(sourceId) {
  const source = sourceId ? nodes.value.find((node) => node.id === sourceId) : null
  if (source) return { x: source.position.x + 340, y: source.position.y }
  const selected = selectedNodes.value[0]
  if (selected) return { x: selected.position.x + 310, y: selected.position.y + 24 }
  if (!nodes.value.length) return { x: 120, y: 120 }
  return {
    x: Math.max(...nodes.value.map((node) => node.position.x)) + 310,
    y: Math.min(...nodes.value.map((node) => node.position.y)),
  }
}

function addNode(type, sourceId, position) {
  const presentation = nodePresentation[type]
  if (!presentation || !activeWorkflow.value) return
  const [kind, detail, tone] = presentation
  const node = {
    id: nextNodeId(type),
    type: 'workflow',
    position: position || nodePosition(sourceId),
    selected: true,
    data: {
      kind,
      label: nodeCatalog.find((item) => item.type === type)?.label || type,
      detail,
      tone,
      status: 'ready',
      workflowType: type,
      config: structuredClone(nodeConfigDefaults[type]),
      inputTypes: nodeDefinition(type)?.inputTypes || [],
      outputType: nodeDefinition(type)?.outputType || null,
    },
  }
  nodes.value = [...nodes.value.map((item) => ({ ...item, selected: false })), node]
  nodeMenuOpen.value = false
  nodeMenuContext.value = null
  scheduleSave()
  nextTick(() => {
    if (sourceId) addConnection(sourceId, node.id)
    fitView({ nodes: [node.id], padding: 1.5, maxZoom: 1, duration: 350 })
  })
}

function catalogForMenu() {
  if (!nodeMenuContext.value?.sourceId) return nodeCatalog
  const source = nodes.value.find((node) => node.id === nodeMenuContext.value.sourceId)
  return source ? compatibleNodeTypes(source.data.workflowType) : []
}

function openNodeMenuAt(clientX, clientY, sourceId = null) {
  const panel = document.querySelector('.canvas-panel')?.getBoundingClientRect()
  nodeMenuContext.value = {
    sourceId,
    position: screenToFlowCoordinate({ x: clientX, y: clientY }),
    left: panel ? clientX - panel.left : 16,
    top: panel ? clientY - panel.top : 70,
  }
  nodeMenuOpen.value = true
}

function selectNodeType(type) {
  const context = nodeMenuContext.value
  addNode(type, context?.sourceId, context?.position)
}

function startNodeDrag(event, type) {
  event.dataTransfer.setData('application/x-workflow-node', type)
  event.dataTransfer.effectAllowed = 'copy'
}

function onCanvasDragOver(event) {
  if (event.dataTransfer.types.includes('application/x-workflow-node')) event.preventDefault()
}

function onCanvasDrop(event) {
  const type = event.dataTransfer.getData('application/x-workflow-node')
  if (!type) return
  event.preventDefault()
  addNode(type, null, screenToFlowCoordinate({ x: event.clientX, y: event.clientY }))
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
}

function selectedFragmentData(name = 'Untitled fragment') {
  const selected = selectedNodes.value
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

async function pasteFragment(fragment = clipboardFragment.value, options = {}) {
  if (!fragment?.nodes?.length) return
  const suffix = Date.now().toString(36)
  const idMap = new Map(fragment.nodes.map((node, index) => [node.id, `${node.id}-${suffix}-${index}`]))
  const maxX = nodes.value.length ? Math.max(...nodes.value.map((node) => node.position.x)) : 0
  const offset = options.offset || { x: maxX + 310, y: 120 }
  const domainNodes = fragment.nodes.map((node) => ({
    ...JSON.parse(JSON.stringify(node)),
    id: idMap.get(node.id),
    ui: { position: { x: node.ui.position.x + offset.x, y: node.ui.position.y + offset.y } },
  }))
  const domainEdges = fragment.edges.map((edge, index) => ({
    ...JSON.parse(JSON.stringify(edge)),
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
  if (options.selectInserted) {
    const insertedIds = new Set(domainNodes.map((node) => node.id))
    nodes.value = nodes.value.map((node) => ({ ...node, selected: insertedIds.has(node.id) }))
  }
  scheduleSave()
}

async function duplicateSelected() {
  const selected = selectedNodes.value
  const fragment = selectedFragmentData('Duplicated selection')
  if (!fragment || !selected.length) return
  const minX = Math.min(...selected.map((node) => node.position.x))
  const minY = Math.min(...selected.map((node) => node.position.y))
  await pasteFragment(fragment, { offset: { x: minX + 24, y: minY + 24 }, selectInserted: true })
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
  if (event.key === 'Escape' && workspaceMode.value === 'model-editor') {
    event.preventDefault()
    closeModelEditor()
    return
  }
  const modifier = event.metaKey || event.ctrlKey
  if (event.key === 'Escape' && nodeMenuOpen.value) {
    nodeMenuOpen.value = false
    nodeMenuContext.value = null
    return
  }
  if (modifier && event.code === 'KeyD') {
    event.preventDefault()
    if (hasSelection.value) duplicateSelected()
    return
  }
  const editing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
  if (editing) return
  if (event.key === '/') {
    event.preventDefault()
    const canvas = document.querySelector('.flow-canvas')?.getBoundingClientRect()
    if (canvas) openNodeMenuAt(canvas.left + canvas.width / 2, canvas.top + canvas.height / 2)
    return
  }
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
  window.addEventListener('keydown', handleKeyboard, true)
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
  window.removeEventListener('keydown', handleKeyboard, true)
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
        <button class="button primary" :disabled="busy || isRunning || !activeWorkflow" @click="runWorkflow()">{{ isRunning ? 'Running…' : busy ? 'Working…' : run ? 'Run again' : 'Run workflow' }}</button>
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
        <div class="sidebar-note"><span>LOCAL WORKSPACE</span><p>Definitions, conversations, fragments, and mock runs persist in this browser.</p></div>
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

      <section class="canvas-panel" @pointerdown.capture="selectCanvasEdge">
        <div class="canvas-toolbar">
          <div><span>CANVAS</span><b>{{ nodes.length }} nodes · {{ edges.length }} connections · {{ selectedCount }} selected</b></div>
          <div><div class="node-menu"><button class="add-node-button" :disabled="!activeWorkflow" @click="nodeMenuContext = null; nodeMenuOpen = !nodeMenuOpen">+ Add node</button><div v-if="nodeMenuOpen && !nodeMenuContext" class="node-menu-popover canvas-node-menu">
            <template v-for="category in nodeCategories" :key="category">
              <strong v-if="catalogForMenu().some((item) => item.category === category)">{{ category }}</strong>
              <button v-for="item in catalogForMenu().filter((item) => item.category === category)" :key="item.type" type="button" draggable="true" @dragstart="startNodeDrag($event, item.type)" @click="selectNodeType(item.type)">
                <span>{{ item.label }}</span><small>{{ item.description }}</small>
              </button>
            </template>
          </div></div><button @click="selectAll">Select all</button><button :disabled="!hasSelection" @click="copySelected">Copy</button><button :disabled="!clipboardFragment" @click="pasteFragment()">Paste</button><button :disabled="!hasSelection" title="Ctrl/Cmd+D" @click="duplicateSelected">Duplicate selected</button><button :disabled="!hasSelection" @click="saveSelectedFragment">Save fragment</button><button @click="zoomOut">−</button><button @click="zoomIn">+</button><button @click="fitView({ padding: .18, duration: 400 })">Fit</button><button :disabled="busy || saving || !nodes.length" @click="autoLayout">Auto layout</button><button :disabled="!hasSelection" @click="deleteSelected">Delete</button></div>
        </div>
        <div v-if="nodeMenuOpen && nodeMenuContext" class="node-menu-popover canvas-node-menu contextual" :style="{ left: `${nodeMenuContext.left}px`, top: `${nodeMenuContext.top}px` }">
          <template v-for="category in nodeCategories" :key="category">
            <strong v-if="catalogForMenu().some((item) => item.category === category)">{{ category }}</strong>
            <button v-for="item in catalogForMenu().filter((item) => item.category === category)" :key="item.type" type="button" draggable="true" @dragstart="startNodeDrag($event, item.type)" @click="selectNodeType(item.type)">
              <span>{{ item.label }}</span><small>{{ item.description }}</small>
            </button>
          </template>
          <small v-if="!catalogForMenu().length" class="node-menu-empty">No compatible node types</small>
        </div>
        <VueFlow v-model:nodes="nodes" v-model:edges="edges" class="flow-canvas" :default-edge-options="edgeDefaults" :delete-key-code="['Backspace', 'Delete']" :is-valid-connection="isValidConnection" :min-zoom=".08" :max-zoom="3.5" :snap-to-grid="false" :pan-on-scroll="true" :pan-on-drag="panOnDrag" :selection-key-code="true" :selection-mode="SelectionMode.Partial" :multi-selection-key-code="'Shift'" fit-view-on-init @dragover="onCanvasDragOver" @drop="onCanvasDrop" @connect="onConnect" @connect-start="onConnectStart" @connect-end="onConnectEnd" @connect-cancel="onConnectCancel" @node-drag-stop="scheduleSave" @nodes-change="onElementsChange" @edges-change="onElementsChange">
          <template #node-workflow="props"><WorkflowNode v-bind="props" :node-run="nodeRuns[props.id] || null" :node-catalog="compatibleNodeTypes(props.data.workflowType)" @update-config="updateNodeConfig(props.id, $event)" @open-model-editor="openModelEditor(props.id)" @preview-image="openImagePreview" @add-next="addNode($event, props.id)" @run-workflow="runWorkflow" /></template>
          <Background :gap="24" :size="1.2" :pattern-color="resolvedTheme === 'dark' ? '#252b2c' : '#cdd2cf'" />
          <MiniMap pannable zoomable :node-stroke-width="3" :mask-color="resolvedTheme === 'dark' ? 'rgba(10, 12, 12, .7)' : 'rgba(238, 241, 238, .72)'" />
          <Controls position="bottom-right" />
          <div class="canvas-caption"><span>WORKFLOW DEFINITION</span><p>{{ activeWorkflow?.description }}</p></div>
        </VueFlow>
        <footer><span><i /> {{ runSummary }}</span><span>Click or drag a node from Add node · Drop a connection on empty canvas to create a compatible node · Press / to add</span></footer>
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
