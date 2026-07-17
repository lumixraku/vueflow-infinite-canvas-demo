<script setup>
import { computed, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeColorPicker from './NodeColorPicker.vue'
import NodeSelect from './NodeSelect.vue'
import NodeSlider from './NodeSlider.vue'

const props = defineProps({ id: { type: String, required: true }, data: { type: Object, required: true }, selected: Boolean, nodeRun: { type: Object, default: null }, nodeCatalog: { type: Array, default: () => [] } })
const emit = defineEmits(['update-config', 'open-model-editor', 'preview-image', 'add-next', 'run-workflow'])
const nextMenuOpen = ref(false)
const parametersOpen = ref(false)
const runtimeStatus = computed(() => props.nodeRun?.status || props.data.status)
const executableTypes = ['generate-image', 'generate-model', 'text-to-3d', 'retopology', 'texture', 'model-preview', 'save-asset', 'export-model']
const isExecutableNode = computed(() => executableTypes.includes(props.data.workflowType))
const showResult = computed(() => !isExecutableNode.value || runtimeStatus.value === 'succeeded')
const actionLabel = computed(() => {
  if (runtimeStatus.value === 'running') return props.data.workflowType === 'save-asset' ? 'Saving…' : props.data.workflowType === 'export-model' ? 'Exporting…' : 'Generating…'
  if (runtimeStatus.value === 'queued') return 'Queued'
  if (runtimeStatus.value === 'failed') return 'Try again'
  if (props.data.workflowType === 'save-asset') return runtimeStatus.value === 'succeeded' ? 'Save again' : 'Save asset'
  if (props.data.workflowType === 'export-model') return runtimeStatus.value === 'succeeded' ? 'Export again' : 'Export'
  return runtimeStatus.value === 'succeeded' ? 'Regenerate' : 'Generate'
})
const runStateTitle = computed(() => {
  if (runtimeStatus.value === 'running') return props.data.workflowType === 'save-asset' ? 'Saving asset' : props.data.workflowType === 'export-model' ? 'Exporting model' : 'Generating result'
  if (runtimeStatus.value === 'queued') return 'Waiting to run'
  if (runtimeStatus.value === 'failed') return props.data.workflowType === 'save-asset' ? 'Save failed' : props.data.workflowType === 'export-model' ? 'Export failed' : 'Generation failed'
  if (runtimeStatus.value === 'succeeded') return props.data.workflowType === 'save-asset' ? 'Asset saved' : props.data.workflowType === 'export-model' ? 'Export ready' : 'Result ready'
  return 'Ready to run'
})
const runStateDetail = computed(() => props.nodeRun?.error || props.nodeRun?.output?.message || (runtimeStatus.value === 'running' ? 'Mock execution is in progress' : 'Run this node to create its output'))
const runtimePreview = computed(() => props.nodeRun?.output?.preview || props.data.config.preview)
const runtimePreviews = computed(() => props.nodeRun?.output?.previews || props.data.config.previews || [])

function update(key, value) {
  emit('update-config', { ...props.data.config, [key]: value })
}

function selectGeneratedImage(image, index) {
  update('selectedPreview', image)
  emit('preview-image', { src: image, alt: `Generated concept ${index + 1}` })
}

const countOptions = [1, 2, 4].map((value) => ({ value, label: String(value) }))
const formatOptions = ['glb', 'fbx', 'obj', 'stl', 'usdz'].map((value) => ({ value, label: value.toUpperCase() }))
</script>

<template>
  <article class="workflow-node" :class="[`tone-${data.tone}`, `is-${runtimeStatus}`, { selected }]">
    <Handle v-if="data.inputTypes?.length" id="input" class="workflow-handle input-handle" type="target" :position="Position.Left" :title="`Accepts ${data.inputTypes.join(' or ')}`" />
    <header><span class="node-kind">{{ data.kind }}</span><span class="node-status" :class="runtimeStatus">{{ runtimeStatus }}</span></header>
    <div class="node-title">
      <span class="node-icon">{{ data.kind.slice(0, 1) }}</span>
      <div><h3>{{ data.label }}</h3><p>{{ data.detail }}</p></div>
    </div>

    <button v-if="data.workflowType === 'text-to-3d'" type="button" class="generate-node nodrag" :disabled="['queued', 'running'].includes(runtimeStatus)" @click.stop="emit('run-workflow', props.id)">{{ runtimeStatus === 'succeeded' ? 'Regenerate' : runtimeStatus === 'failed' ? 'Try again' : runtimeStatus === 'running' ? 'Generating…' : runtimeStatus === 'queued' ? 'Queued' : '▷ Generate' }}</button>

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
        <label>Background<NodeColorPicker :model-value="data.config.background" @update:model-value="update('background', $event)" /></label>
        <label class="toggle-row"><span>Auto rotate</span><input type="checkbox" :checked="data.config.autoRotate" @change="update('autoRotate', $event.target.checked)" /></label>
        <label class="toggle-row"><span>Wireframe</span><input type="checkbox" :checked="data.config.wireframe" @change="update('wireframe', $event.target.checked)" /></label>
      </template>

      <template v-else-if="data.workflowType === 'save-asset'">
        <label>Collection<input :value="data.config.collection" @input="update('collection', $event.target.value)" /></label>
        <label>Tags<input :value="data.config.tags" placeholder="character, stylized" @input="update('tags', $event.target.value)" /></label>
        <label class="toggle-row"><span>Save preview render</span><input type="checkbox" :checked="data.config.savePreview" @change="update('savePreview', $event.target.checked)" /></label>
      </template>

      <template v-else-if="data.workflowType === 'export-model'">
        <label>Format<NodeSelect :model-value="data.config.format" :options="formatOptions" @update:model-value="update('format', $event)" /></label>
        <label>Mesh compression<NodeSelect :model-value="data.config.compression" :options="['Draco', 'Meshopt', 'None']" @update:model-value="update('compression', $event)" /></label>
        <label class="toggle-row"><span>Include textures</span><input type="checkbox" :checked="data.config.includeTextures" @change="update('includeTextures', $event.target.checked)" /></label>
      </template>
    </div>

    <button v-if="isExecutableNode && data.workflowType !== 'text-to-3d'" type="button" class="generate-node nodrag" :disabled="['queued', 'running'].includes(runtimeStatus)" @click.stop="emit('run-workflow', props.id)">{{ actionLabel }}</button>
    <button v-if="['generate-model', 'text-to-3d', 'retopology', 'texture', 'model-preview'].includes(data.workflowType) && showResult" type="button" class="open-model-editor nodrag" @click.stop="emit('open-model-editor')"><span>Open in Model Editor</span><b>↗</b></button>
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
