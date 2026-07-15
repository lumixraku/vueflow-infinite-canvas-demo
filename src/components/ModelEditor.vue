<script setup>
import '@google/model-viewer'
import NodeSelect from './NodeSelect.vue'

const props = defineProps({ node: { type: Object, required: true } })
const emit = defineEmits(['back', 'update-config'])

function update(key, value) {
  emit('update-config', { ...props.node.data.config, [key]: value })
}
</script>

<template>
  <section class="model-editor-workspace">
    <aside class="model-tools" aria-label="Model tools">
      <button class="active" title="Select">↖<span>Select</span></button>
      <button title="Move">✣<span>Move</span></button>
      <button title="Rotate">↻<span>Rotate</span></button>
      <button title="Scale">⌗<span>Scale</span></button>
      <span class="tool-divider" />
      <button title="Sculpt">◒<span>Sculpt</span></button>
      <button title="Paint">◩<span>Paint</span></button>
    </aside>

    <section class="model-stage">
      <header class="model-stage-header">
        <div>
          <button class="back-to-workflow" @click="emit('back')">← Workflow</button>
          <span>MODEL EDITOR</span>
          <strong>{{ node.data.label }}</strong>
        </div>
        <div class="stage-actions">
          <button>Compare</button>
          <button>Snapshot</button>
          <button class="button primary">Save version</button>
        </div>
      </header>

      <div class="model-viewport" :style="{ '--viewport-background': node.data.config.background || '#202322' }">
        <model-viewer
          src="/models/shark-gardener.glb"
          alt="Shark gardener 3D model"
          camera-controls
          shadow-intensity="1.2"
          shadow-softness=".8"
          exposure="1.05"
          interaction-prompt="none"
          :auto-rotate="node.data.config.autoRotate !== false"
        />
        <div class="viewport-status"><i /> REALTIME · GLB · PBR</div>
        <div class="viewport-hint">Drag to orbit · Scroll to zoom · Double-click to focus</div>
        <div class="axis-widget"><b>Z</b><span>X</span><i>Y</i></div>
        <div class="view-cube"><span>FRONT</span></div>
      </div>

      <footer class="model-timeline">
        <div><span>VERSION HISTORY</span><b>Mesh generation → Retopology → Texture pass</b></div>
        <div class="version-track"><i /><i /><i class="active" /></div>
        <span>v03 · Current</span>
      </footer>
    </section>

    <aside class="model-inspector">
      <header><span>INSPECTOR</span><b>Asset properties</b></header>
      <section class="asset-summary">
        <img :src="node.data.config.preview || '/shark-review.png'" alt="Model preview" />
        <div><strong>Shark Gardener</strong><span>Meshy export · GLB</span></div>
      </section>
      <section class="inspector-section">
        <div class="section-heading"><span>SCENE</span><b>01 object</b></div>
        <button class="scene-item active"><i /> Shark_Gardener <span>◉</span></button>
      </section>
      <section class="inspector-section inspector-fields">
        <div class="section-heading"><span>VIEWPORT</span><b>Live</b></div>
        <label>Environment<NodeSelect :model-value="node.data.config.environment || 'Studio'" :options="['Studio', 'Outdoor', 'Neutral']" @update:model-value="update('environment', $event)" /></label>
        <label>Background<input type="color" :value="node.data.config.background || '#202322'" @input="update('background', $event.target.value)" /></label>
        <label class="toggle-row"><span>Auto rotate</span><input type="checkbox" :checked="node.data.config.autoRotate !== false" @change="update('autoRotate', $event.target.checked)" /></label>
        <label class="toggle-row"><span>Wireframe overlay</span><input type="checkbox" :checked="node.data.config.wireframe" @change="update('wireframe', $event.target.checked)" /></label>
      </section>
      <section class="inspector-section model-stats">
        <div class="section-heading"><span>GEOMETRY</span><b>Optimized</b></div>
        <dl><div><dt>Triangles</dt><dd>38,420</dd></div><div><dt>Vertices</dt><dd>19,776</dd></div><div><dt>Materials</dt><dd>4</dd></div><div><dt>Textures</dt><dd>2K PBR</dd></div></dl>
      </section>
      <div class="inspector-note"><span>WORKFLOW LINKED</span><p>Viewport changes save back to the selected workflow node automatically.</p></div>
    </aside>
  </section>
</template>
