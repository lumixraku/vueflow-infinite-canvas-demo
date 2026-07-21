<script setup>
import { computed, nextTick, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeSelect from './NodeSelect.vue'
import NodeSlider from './NodeSlider.vue'

const props = defineProps({ id: { type: String, required: true }, data: { type: Object, required: true }, selected: Boolean, nodeRun: { type: Object, default: null }, runId: { type: String, default: null }, nodeCatalog: { type: Array, default: () => [] } })
const emit = defineEmits(['update-config', 'update-name', 'open-model-editor', 'preview-image', 'add-next', 'run-workflow', 'run-downstream'])
const nextMenuOpen = ref(false)
const parametersOpen = ref(false)
const runDetailsOpen = ref(false)
const editingName = ref(false)
const draftName = ref('')
const nameInput = ref(null)
const runtimeStatus = computed(() => props.nodeRun?.status || props.data.status)
const executableTypes = ['generate-image', 'generate-model', 'text-to-3d', 'retopology', 'texture', 'model-preview']
const isExecutableNode = computed(() => executableTypes.includes(props.data.workflowType))
const showResult = computed(() => !isExecutableNode.value || runtimeStatus.value === 'succeeded')
const actionLabel = computed(() => {
  if (runtimeStatus.value === 'running') return 'Generating…'
  if (runtimeStatus.value === 'queued') return 'Queued'
  if (runtimeStatus.value === 'failed') return 'Try again'
  return runtimeStatus.value === 'succeeded' ? 'Regenerate' : 'Generate'
})
const runStateTitle = computed(() => {
  if (runtimeStatus.value === 'running') return 'Generating result'
  if (runtimeStatus.value === 'queued') return 'Waiting to run'
  if (runtimeStatus.value === 'failed') return 'Generation failed'
  if (runtimeStatus.value === 'succeeded') return 'Result ready'
  return 'Ready to run'
})
const runStateDetail = computed(() => props.nodeRun?.error || props.nodeRun?.output?.message || (runtimeStatus.value === 'running' ? 'Mock execution is in progress' : 'Run this node to create its output'))
const runtimePreview = computed(() => props.nodeRun?.output?.preview || props.data.config.preview)
const runtimePreviews = computed(() => props.nodeRun?.output?.previews || props.data.config.previews || [])
const runConfig = computed(() => {
  const keys = {
    'generate-image': ['model', 'count', 'aspectRatio'],
    'generate-model': ['modelVersion', 'textureMode', 'faceCount'],
    'text-to-3d': ['modelVersion', 'textureMode', 'faceCount'],
    retopology: ['modelVersion', 'faceType', 'faceLimit'],
    texture: ['model', 'resolution', 'style'],
    'model-preview': ['environment', 'autoRotate', 'wireframe'],
  }[props.data.workflowType] || []
  return keys.map((key) => [key, props.data.config[key]])
})

function update(key, value) {
  emit('update-config', { ...props.data.config, [key]: value })
}

function startNameEdit() {
  draftName.value = props.data.label
  editingName.value = true
  nextTick(() => {
    nameInput.value?.focus()
    nameInput.value?.select()
  })
}

function saveName() {
  if (!editingName.value) return
  const name = draftName.value.trim()
  editingName.value = false
  if (name && name !== props.data.label) emit('update-name', name)
}

function cancelNameEdit() {
  editingName.value = false
  draftName.value = props.data.label
}

function selectGeneratedImage(image, index) {
  update('selectedPreview', image)
  emit('preview-image', { src: image, alt: `Generated concept ${index + 1}` })
}

const countOptions = [1, 2, 4].map((value) => ({ value, label: String(value) }))
</script>

<template>
  <article class="workflow-node" :class="[`tone-${data.tone}`, `is-${runtimeStatus}`, { selected }]">
    <Handle v-if="data.inputTypes?.length" id="input" class="workflow-handle input-handle" type="target" :position="Position.Left" :title="`Accepts ${data.inputTypes.join(' or ')}`" />
    <header><span class="node-kind">{{ data.kind }}</span><span class="node-status" :class="runtimeStatus">{{ runtimeStatus }}</span></header>
    <div class="node-title">
      <span class="node-icon">{{ data.kind.slice(0, 1) }}</span>
      <div class="node-title-copy">
        <input v-if="editingName" ref="nameInput" v-model="draftName" class="node-name-input nodrag nopan" aria-label="Node name" @click.stop @dblclick.stop @pointerdown.stop @keydown.enter.prevent="saveName" @keydown.esc.prevent="cancelNameEdit" @blur="saveName" />
        <h3 v-else title="Double-click to rename" @dblclick.stop="startNameEdit">{{ data.label }}</h3>
        <p>{{ data.detail }}</p>
      </div>
    </div>

    <div v-if="data.workflowType === 'generate-image' && showResult" class="node-output image-grid" aria-label="Generated image candidates">
      <button v-for="(image, index) in runtimePreviews" :key="`${image}-${index}`" type="button" class="image-candidate nodrag nopan" :class="{ selected: data.config.selectedPreview === image }" :aria-label="`Select and preview generated concept ${index + 1}`" :aria-pressed="data.config.selectedPreview === image" @click.stop="selectGeneratedImage(image, index)">
        <img :src="image" :alt="`Generated concept ${index + 1}`" />
      </button>
      <span class="output-badge">{{ runtimePreviews.length }} candidates</span>
    </div>
    <button v-else-if="['reference-image', 'generate-model', 'text-to-3d', 'retopology', 'texture', 'model-preview'].includes(data.workflowType) && showResult" type="button" class="node-output nodrag nopan" :class="{ 'model-output': data.workflowType !== 'reference-image' }" :aria-label="data.workflowType === 'reference-image' ? `Preview ${data.label} image` : `Open ${data.label} in Model Editor`" @click.stop="data.workflowType === 'reference-image' ? emit('preview-image', { src: runtimePreview, alt: `${data.label} result` }) : emit('open-model-editor')">
      <img :src="runtimePreview" :alt="`${data.label} result`" />
      <div v-if="data.workflowType !== 'reference-image'" class="model-orbit"><span /><span /><span /></div>
      <span class="output-badge">{{ data.workflowType === 'reference-image' ? 'Input image' : data.workflowType === 'retopology' ? `${Number(data.config.faceLimit).toLocaleString()} faces` : data.workflowType === 'texture' ? `${data.config.resolution} PBR` : '3D result' }}</span>
    </button>
    <div v-else-if="data.workflowType === 'review'" class="node-run-state" :class="runtimeStatus">
      <strong>{{ runtimeStatus === 'waiting_review' ? 'Awaiting approval' : 'Review checkpoint' }}</strong>
      <small>{{ data.config.instruction }}</small>
      <button type="button" class="node-output nodrag nopan" :aria-label="`Preview ${data.label} image`" @click.stop="emit('preview-image', { src: data.config.preview, alt: `${data.label} image` })"><img :src="data.config.preview" :alt="`${data.label} image`" /></button>
      <button v-if="runtimeStatus === 'waiting_review'" type="button" class="generate-node nodrag" @click.stop="update('approved', true); emit('run-downstream', props.id)">Approve and continue</button>
    </div>
    <div v-else-if="isExecutableNode && (data.workflowType !== 'text-to-3d' || runtimeStatus !== 'ready')" class="node-run-state" :class="runtimeStatus">
      <span class="node-run-indicator" />
      <strong>{{ runStateTitle }}</strong>
      <small>{{ runStateDetail }}</small>
    </div>

    <button v-if="data.workflowType === 'text-to-3d'" type="button" class="node-parameters-toggle nodrag" :aria-expanded="parametersOpen" @click.stop="parametersOpen = !parametersOpen"><span>Parameters</span><b :class="{ open: parametersOpen }">⌄</b></button>
    <div v-show="data.workflowType !== 'text-to-3d' || parametersOpen" class="node-editor nodrag">
      <template v-if="data.workflowType === 'reference-image'">
        <label>Source<NodeSelect :model-value="data.config.sourceType" :options="['Upload', 'Asset Library', 'URL']" @update:model-value="update('sourceType', $event)" /></label>
        <label>Image reference<input :value="data.config.reference" placeholder="Select image or paste URL" @input="update('reference', $event.target.value)" /></label>
        <label>Background<NodeSelect :model-value="data.config.background" :options="['Keep', 'Remove']" @update:model-value="update('background', $event)" /></label>
      </template>

      <template v-else-if="data.workflowType === 'prompt'">
        <label>Prompt<textarea :value="data.config.prompt" rows="4" @input="update('prompt', $event.target.value)" /></label>
        <label>Prompt strength<div class="range-row"><NodeSlider :model-value="data.config.strength" :min="0" :max="100" @update:model-value="update('strength', $event)" /><output>{{ data.config.strength }}%</output></div></label>
      </template>

      <template v-else-if="data.workflowType === 'generate-image'">
        <label>Image model<NodeSelect :model-value="data.config.model" :options="['GPT Image 2', 'Flux 1.1 Pro', 'Stable Diffusion 3.5']" @update:model-value="update('model', $event)" /></label>
        <div class="field-grid"><label>Count<NodeSelect :model-value="data.config.count" :options="countOptions" @update:model-value="update('count', $event)" /></label><label>Aspect ratio<NodeSelect :model-value="data.config.aspectRatio" :options="['1:1', '4:3', '3:4', '16:9']" @update:model-value="update('aspectRatio', $event)" /></label></div>
        <label>Reference mode<NodeSelect :model-value="data.config.referenceMode" :options="['Image + Prompt', 'Prompt only', 'Image variation']" @update:model-value="update('referenceMode', $event)" /></label>
      </template>

      <template v-else-if="['generate-model', 'text-to-3d'].includes(data.workflowType)">
        <label>Model version<NodeSelect :model-value="data.config.modelVersion" :options="['Smart Mesh', 'v2.5', 'v2.0']" @update:model-value="update('modelVersion', $event)" /></label>
        <fieldset><legend>Texture</legend><div class="segmented"><button v-for="option in ['None', 'HD', 'PBR']" :key="option" type="button" :class="{ active: data.config.textureMode === option }" @click="update('textureMode', option)">{{ option }}</button></div></fieldset>
        <fieldset><legend>Face type</legend><div class="segmented"><button v-for="option in ['Triangle', 'Quad']" :key="option" type="button" :class="{ active: data.config.faceType === option }" @click="update('faceType', option)">{{ option }}</button></div></fieldset>
        <label>Face count<div class="range-row"><NodeSlider :model-value="data.config.faceCount" :min="1000" :max="50000" :step="1000" @update:model-value="update('faceCount', $event)" /><output>{{ Number(data.config.faceCount).toLocaleString() }}</output></div></label>
      </template>

      <template v-else-if="data.workflowType === 'retopology'">
        <label>Model version<NodeSelect :model-value="data.config.modelVersion" :options="['v2.0', 'v1.0']" @update:model-value="update('modelVersion', $event)" /></label>
        <label>Face type<NodeSelect :model-value="data.config.faceType" :options="['Triangle', 'Quad']" @update:model-value="update('faceType', $event)" /></label>
        <label>Face limit<div class="range-row"><NodeSlider :model-value="data.config.faceLimit" :min="500" :max="20000" :step="500" @update:model-value="update('faceLimit', $event)" /><output>{{ Number(data.config.faceLimit).toLocaleString() }}</output></div></label>
        <label class="toggle-row"><span>Bake textures</span><input type="checkbox" :checked="data.config.bakeTextures" @change="update('bakeTextures', $event.target.checked)" /></label>
      </template>

      <template v-else-if="data.workflowType === 'texture'">
        <label>Texture model<NodeSelect :model-value="data.config.model" :options="['Texture v2.0', 'Texture v1.5']" @update:model-value="update('model', $event)" /></label>
        <div class="field-grid"><label>Resolution<NodeSelect :model-value="data.config.resolution" :options="['1K', '2K', '4K']" @update:model-value="update('resolution', $event)" /></label><label>Style<NodeSelect :model-value="data.config.style" :options="['Original', 'Realistic', 'Stylized']" @update:model-value="update('style', $event)" /></label></div>
        <label class="toggle-row"><span>Generate PBR maps</span><input type="checkbox" :checked="data.config.pbr" @change="update('pbr', $event.target.checked)" /></label>
      </template>

      <template v-else-if="data.workflowType === 'model-preview'">
        <label>Environment<NodeSelect :model-value="data.config.environment" :options="['Studio', 'Outdoor', 'Neutral']" @update:model-value="update('environment', $event)" /></label>
        <label class="toggle-row"><span>Auto rotate</span><input type="checkbox" :checked="data.config.autoRotate" @change="update('autoRotate', $event.target.checked)" /></label>
        <label class="toggle-row"><span>Wireframe</span><input type="checkbox" :checked="data.config.wireframe" @change="update('wireframe', $event.target.checked)" /></label>
      </template>
    </div>

    <div v-if="isExecutableNode" class="node-run-actions nodrag">
      <button type="button" class="generate-node" :disabled="['queued', 'running'].includes(runtimeStatus)" @click.stop="emit('run-workflow', props.id)">{{ actionLabel }}</button>
      <button type="button" class="run-downstream" :disabled="['queued', 'running'].includes(runtimeStatus)" @click.stop="emit('run-downstream', props.id)">Run downstream</button>
    </div>
    <button v-if="['generate-model', 'text-to-3d', 'retopology', 'texture', 'model-preview'].includes(data.workflowType) && showResult" type="button" class="open-model-editor nodrag" @click.stop="emit('open-model-editor')"><span>Open in Model Editor</span><b>↗</b></button>
    <section v-if="nodeRun" class="node-run-details nodrag">
      <button type="button" :aria-expanded="runDetailsOpen" @click.stop="runDetailsOpen = !runDetailsOpen"><span>Run details</span><b :class="{ open: runDetailsOpen }">⌄</b></button>
      <div v-if="runDetailsOpen" class="node-run-detail-content">
        <small>Run {{ runId || 'previous run' }}</small>
        <dl><div><dt>Node</dt><dd>{{ id }}</dd></div><div><dt>Type</dt><dd>{{ data.workflowType }}</dd></div><div><dt>Status</dt><dd>{{ nodeRun.status }}</dd></div><div><dt>Duration</dt><dd>{{ nodeRun.durationMs === null ? 'Pending' : `${nodeRun.durationMs} ms` }}</dd></div></dl>
        <dl v-if="runConfig.length" class="node-run-config"><div v-for="[key, value] in runConfig" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></div></dl>
        <p>{{ nodeRun.error || nodeRun.output?.message || 'Waiting for output' }}</p>
      </div>
    </section>
    <footer><span>{{ nodeRun?.output?.message || nodeRun?.error || 'Editable parameters' }}</span><span v-if="nodeRun?.durationMs !== null && nodeRun?.durationMs !== undefined">{{ nodeRun.durationMs }} ms</span><span v-else class="node-pulse" /></footer>
    <Handle v-if="data.outputType" id="output" class="workflow-handle output-handle" type="source" :position="Position.Right" :title="`Outputs ${data.outputType}`" />
    <div class="node-next-control nodrag nopan" :class="{ open: nextMenuOpen }">
      <button type="button" class="node-next-button" aria-label="Add and connect next node" :aria-expanded="nextMenuOpen" @click.stop="nextMenuOpen = !nextMenuOpen">+</button>
      <div v-if="nextMenuOpen" class="node-next-menu">
        <button v-for="item in nodeCatalog" :key="item.type" type="button" @click.stop="emit('add-next', item.type); nextMenuOpen = false">
          <span>{{ item.label }}</span><small>{{ item.description }}</small>
        </button>
      </div>
    </div>
  </article>
</template>
