<script setup>
import { computed, nextTick, ref } from 'vue'
import {
  MarkerType,
  VueFlow,
  addEdge,
  useVueFlow,
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import WorkflowNode from './components/WorkflowNode.vue'

const initialNodes = [
  {
    id: 'trigger',
    type: 'workflow',
    position: { x: 0, y: 120 },
    data: { kind: 'TRIGGER', label: 'Webhook received', detail: 'Validate incoming payload', meta: '12 req/min', tone: 'cyan', status: 'live' },
  },
  {
    id: 'classify',
    type: 'workflow',
    position: { x: 330, y: 20 },
    data: { kind: 'AI MODEL', label: 'Classify intent', detail: 'Route by confidence score', meta: '842 ms', tone: 'violet', status: 'ready' },
  },
  {
    id: 'review',
    type: 'workflow',
    position: { x: 330, y: 230 },
    data: { kind: 'CONDITION', label: 'Needs review?', detail: 'Confidence below 0.82', meta: '2 branches', tone: 'amber', status: 'ready' },
  },
  {
    id: 'publish',
    type: 'workflow',
    position: { x: 670, y: 20 },
    data: { kind: 'ACTION', label: 'Publish result', detail: 'Write to customer timeline', meta: '99.98% success', tone: 'green', status: 'ready' },
  },
  {
    id: 'queue',
    type: 'workflow',
    position: { x: 670, y: 230 },
    data: { kind: 'QUEUE', label: 'Human review', detail: 'Assign to operations team', meta: '4 waiting', tone: 'rose', status: 'paused' },
  },
]

const initialEdges = [
  { id: 'e1', source: 'trigger', target: 'classify', animated: true },
  { id: 'e2', source: 'trigger', target: 'review' },
  { id: 'e3', source: 'classify', target: 'publish', animated: true },
  { id: 'e4', source: 'review', target: 'queue' },
]

const nodes = ref(initialNodes)
const edges = ref(initialEdges)
const selectedCount = ref(0)
const farNodeId = ref(null)
const nodeSequence = ref(1)

const { addNodes, fitView, getSelectedNodes, project, setCenter, zoomIn, zoomOut } = useVueFlow()

const edgeDefaults = {
  type: 'bezier',
  markerEnd: MarkerType.ArrowClosed,
  style: { strokeWidth: 1.6 },
}

const stats = computed(() => [
  `${nodes.value.length} nodes`,
  `${edges.value.length} edges`,
  `${selectedCount.value} selected`,
])

function onConnect(connection) {
  edges.value = addEdge({ ...connection, ...edgeDefaults }, edges.value)
}

function onSelectionChange({ nodes: selectedNodes }) {
  selectedCount.value = selectedNodes.length
}

function addNode() {
  const id = `new-${nodeSequence.value++}`
  const position = project({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  addNodes({
    id,
    type: 'workflow',
    position: { x: position.x - 100, y: position.y - 60 },
    data: { kind: 'NEW STEP', label: `Untitled step ${nodeSequence.value - 1}`, detail: 'Drag a handle to connect', meta: 'Just created', tone: 'cyan', status: 'draft' },
  })
}

async function addFarNode() {
  const id = `far-${Date.now()}`
  farNodeId.value = id
  addNodes({
    id,
    type: 'workflow',
    position: { x: 6400, y: -3800 },
    data: { kind: 'REMOTE NODE', label: '6,400 px away', detail: 'The canvas continues out here', meta: 'x 6400 / y -3800', tone: 'violet', status: 'found' },
  })
  await nextTick()
  setCenter(6500, -3730, { zoom: 1, duration: 900 })
}

function returnHome() {
  fitView({ nodes: nodes.value.filter((node) => node.id !== farNodeId.value), padding: 0.2, duration: 700 })
}

function deleteSelected() {
  const ids = new Set(getSelectedNodes.value.map((node) => node.id))
  if (!ids.size) return
  nodes.value = nodes.value.filter((node) => !ids.has(node.id))
  edges.value = edges.value.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target))
}
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <span class="brand-mark">VF</span>
        <div>
          <strong>Infinite Canvas Lab</strong>
          <small>Vue Flow capability demo</small>
        </div>
      </div>
      <div class="topbar-stats" aria-label="Flow statistics">
        <span v-for="stat in stats" :key="stat">{{ stat }}</span>
      </div>
      <a href="https://vueflow.dev" target="_blank" rel="noreferrer">DOCS ↗</a>
    </header>

    <section class="workspace">
      <aside class="tool-rail" aria-label="Canvas tools">
        <button title="Add node" @click="addNode"><b>+</b><span>Add</span></button>
        <button title="Zoom in" @click="zoomIn"><b>＋</b><span>Zoom</span></button>
        <button title="Zoom out" @click="zoomOut"><b>−</b><span>Zoom</span></button>
        <button title="Fit workflow" @click="returnHome"><b>⌗</b><span>Fit</span></button>
        <button title="Delete selected nodes" @click="deleteSelected"><b>×</b><span>Delete</span></button>
      </aside>

      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        class="flow-canvas"
        :default-edge-options="edgeDefaults"
        :min-zoom="0.08"
        :max-zoom="3.5"
        :snap-to-grid="false"
        :pan-on-scroll="true"
        :selection-on-drag="true"
        :multi-selection-key-code="'Shift'"
        fit-view-on-init
        @connect="onConnect"
        @selection-change="onSelectionChange"
      >
        <template #node-workflow="props">
          <WorkflowNode v-bind="props" />
        </template>

        <Background :gap="24" :size="1.2" pattern-color="#28303a" />
        <MiniMap
          pannable
          zoomable
          :node-stroke-width="3"
          :mask-color="'rgba(7, 10, 13, 0.72)'"
        />
        <Controls position="bottom-right" />

        <div class="canvas-hint">
          <span>SCROLL TO PAN</span>
          <span>PINCH TO ZOOM</span>
          <span>DRAG EMPTY SPACE TO SELECT</span>
        </div>

        <section class="capability-card">
          <p>CANVAS RANGE TEST</p>
          <h1>How far does it go?</h1>
          <span>Vue Flow uses a transformable coordinate plane. Put a node thousands of pixels away, then navigate back through the MiniMap.</span>
          <div>
            <button @click="addFarNode">Jump to x 6,400</button>
            <button class="secondary" @click="returnHome">Return home</button>
          </div>
        </section>
      </VueFlow>
    </section>

    <footer class="statusbar">
      <span><i class="online" /> ENGINE READY</span>
      <span>FREE POSITIONING</span>
      <span>ZOOM 8%–350%</span>
      <span class="desktop-only">DRAG HANDLES TO CONNECT</span>
    </footer>
  </main>
</template>
