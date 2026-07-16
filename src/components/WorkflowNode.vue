<script setup>
import { Handle, Position } from '@vue-flow/core'
import NodeSelect from './NodeSelect.vue'

const props = defineProps({ data: { type: Object, required: true }, selected: Boolean })
const emit = defineEmits(['update-config', 'open-model-editor', 'preview-image'])

function update(key, value) {
  emit('update-config', { ...props.data.config, [key]: value })
}

function numberValue(event) {
  return Number(event.target.value)
}

function selectGeneratedImage(image, index) {
  update('selectedPreview', image)
  emit('preview-image', { src: image, alt: `Generated concept ${index + 1}` })
}

const countOptions = [1, 2, 4].map((value) => ({ value, label: String(value) }))
const formatOptions = ['glb', 'fbx', 'obj', 'stl', 'usdz'].map((value) => ({ value, label: value.toUpperCase() }))
</script>

<template>
  <article class="workflow-node" :class="[`tone-${data.tone}`, { selected }]">
    <Handle id="input" type="target" :position="Position.Left" />
    <header><span class="node-kind">{{ data.kind }}</span><span class="node-status" :class="data.status">{{ data.status }}</span></header>
    <div class="node-title">
      <span class="node-icon">{{ data.kind.slice(0, 1) }}</span>
      <div><h3>{{ data.label }}</h3><p>{{ data.detail }}</p></div>
    </div>

    <div v-if="data.workflowType === 'generate-image'" class="node-output image-grid" aria-label="Generated image candidates">
      <button v-for="(image, index) in data.config.previews" :key="`${image}-${index}`" type="button" class="image-candidate nodrag nopan" :class="{ selected: data.config.selectedPreview === image }" :aria-label="`Select and preview generated concept ${index + 1}`" :aria-pressed="data.config.selectedPreview === image" @click.stop="selectGeneratedImage(image, index)">
        <img :src="image" :alt="`Generated concept ${index + 1}`" />
      </button>
      <span class="output-badge">{{ data.config.previews.length }} candidates</span>
    </div>
    <button v-else-if="['reference-image', 'generate-model', 'retopology', 'texture', 'model-preview'].includes(data.workflowType)" type="button" class="node-output nodrag nopan" :class="{ 'model-output': data.workflowType !== 'reference-image' }" :aria-label="data.workflowType === 'reference-image' ? `Preview ${data.label} image` : `Open ${data.label} in Model Editor`" @click.stop="data.workflowType === 'reference-image' ? emit('preview-image', { src: data.config.preview, alt: `${data.label} result` }) : emit('open-model-editor')">
      <img :src="data.config.preview" :alt="`${data.label} result`" />
      <div v-if="data.workflowType !== 'reference-image'" class="model-orbit"><span /><span /><span /></div>
      <span class="output-badge">{{ data.workflowType === 'reference-image' ? 'Input image' : data.workflowType === 'retopology' ? `${Number(data.config.faceLimit).toLocaleString()} faces` : data.workflowType === 'texture' ? `${data.config.resolution} PBR` : '3D result' }}</span>
    </button>

    <div class="node-editor nodrag">
      <template v-if="data.workflowType === 'reference-image'">
        <label>Source<NodeSelect :model-value="data.config.sourceType" :options="['Upload', 'Asset Library', 'URL']" @update:model-value="update('sourceType', $event)" /></label>
        <label>Image reference<input :value="data.config.reference" placeholder="Select image or paste URL" @input="update('reference', $event.target.value)" /></label>
        <label>Background<NodeSelect :model-value="data.config.background" :options="['Keep', 'Remove']" @update:model-value="update('background', $event)" /></label>
      </template>

      <template v-else-if="data.workflowType === 'prompt'">
        <label>Prompt<textarea :value="data.config.prompt" rows="4" @input="update('prompt', $event.target.value)" /></label>
        <label>Prompt strength<div class="range-row"><input type="range" min="0" max="100" :value="data.config.strength" @input="update('strength', numberValue($event))" /><output>{{ data.config.strength }}%</output></div></label>
      </template>

      <template v-else-if="data.workflowType === 'generate-image'">
        <label>Image model<NodeSelect :model-value="data.config.model" :options="['GPT Image 2', 'Flux 1.1 Pro', 'Stable Diffusion 3.5']" @update:model-value="update('model', $event)" /></label>
        <div class="field-grid"><label>Count<NodeSelect :model-value="data.config.count" :options="countOptions" @update:model-value="update('count', $event)" /></label><label>Aspect ratio<NodeSelect :model-value="data.config.aspectRatio" :options="['1:1', '4:3', '3:4', '16:9']" @update:model-value="update('aspectRatio', $event)" /></label></div>
        <label>Reference mode<NodeSelect :model-value="data.config.referenceMode" :options="['Image + Prompt', 'Prompt only', 'Image variation']" @update:model-value="update('referenceMode', $event)" /></label>
      </template>

      <template v-else-if="data.workflowType === 'generate-model'">
        <label>Model version<NodeSelect :model-value="data.config.modelVersion" :options="['Smart Mesh', 'v2.5', 'v2.0']" @update:model-value="update('modelVersion', $event)" /></label>
        <fieldset><legend>Texture</legend><div class="segmented"><button v-for="option in ['None', 'HD', 'PBR']" :key="option" type="button" :class="{ active: data.config.textureMode === option }" @click="update('textureMode', option)">{{ option }}</button></div></fieldset>
        <fieldset><legend>Face type</legend><div class="segmented"><button v-for="option in ['Triangle', 'Quad']" :key="option" type="button" :class="{ active: data.config.faceType === option }" @click="update('faceType', option)">{{ option }}</button></div></fieldset>
        <label>Face count<div class="range-row"><input type="range" min="1000" max="50000" step="1000" :value="data.config.faceCount" @input="update('faceCount', numberValue($event))" /><output>{{ Number(data.config.faceCount).toLocaleString() }}</output></div></label>
      </template>

      <template v-else-if="data.workflowType === 'retopology'">
        <label>Model version<NodeSelect :model-value="data.config.modelVersion" :options="['v2.0', 'v1.0']" @update:model-value="update('modelVersion', $event)" /></label>
        <label>Face type<NodeSelect :model-value="data.config.faceType" :options="['Triangle', 'Quad']" @update:model-value="update('faceType', $event)" /></label>
        <label>Face limit<div class="range-row"><input type="range" min="500" max="20000" step="500" :value="data.config.faceLimit" @input="update('faceLimit', numberValue($event))" /><output>{{ Number(data.config.faceLimit).toLocaleString() }}</output></div></label>
        <label class="toggle-row"><span>Bake textures</span><input type="checkbox" :checked="data.config.bakeTextures" @change="update('bakeTextures', $event.target.checked)" /></label>
      </template>

      <template v-else-if="data.workflowType === 'texture'">
        <label>Texture model<NodeSelect :model-value="data.config.model" :options="['Texture v2.0', 'Texture v1.5']" @update:model-value="update('model', $event)" /></label>
        <div class="field-grid"><label>Resolution<NodeSelect :model-value="data.config.resolution" :options="['1K', '2K', '4K']" @update:model-value="update('resolution', $event)" /></label><label>Style<NodeSelect :model-value="data.config.style" :options="['Original', 'Realistic', 'Stylized']" @update:model-value="update('style', $event)" /></label></div>
        <label class="toggle-row"><span>Generate PBR maps</span><input type="checkbox" :checked="data.config.pbr" @change="update('pbr', $event.target.checked)" /></label>
      </template>

      <template v-else-if="data.workflowType === 'model-preview'">
        <label>Environment<NodeSelect :model-value="data.config.environment" :options="['Studio', 'Outdoor', 'Neutral']" @update:model-value="update('environment', $event)" /></label>
        <label>Background<input type="color" :value="data.config.background" @input="update('background', $event.target.value)" /></label>
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

    <button v-if="['generate-model', 'retopology', 'texture', 'model-preview'].includes(data.workflowType)" type="button" class="open-model-editor nodrag" @click.stop="emit('open-model-editor')"><span>Open in Model Editor</span><b>↗</b></button>
    <footer><span>Editable parameters</span><span class="node-pulse" /></footer>
    <Handle id="output" type="source" :position="Position.Right" />
  </article>
</template>
