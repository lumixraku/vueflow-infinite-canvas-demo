<script setup>
import { computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'

const props = defineProps({
  width: { type: Number, default: 160 },
  height: { type: Number, default: 100 },
  padding: { type: Number, default: 48 },
  maskColor: { type: String, default: 'rgba(10, 12, 12, .7)' },
  nodeColor: { type: String, default: '#606a63' },
  nodeStrokeColor: { type: String, default: '#929a94' },
})

const { getNodes, viewport, dimensions } = useVueFlow()

const visibleNodes = computed(() => getNodes.value.filter((node) => !node.hidden))

const nodeBounds = computed(() => {
  const nodes = visibleNodes.value
  if (!nodes.length) {
    return { x: 0, y: 0, width: props.width, height: props.height }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    const width = Number(node.dimensions?.width || node.width || 260)
    const height = Number(node.dimensions?.height || node.height || 430)
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + width)
    maxY = Math.max(maxY, node.position.y + height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
})

const viewBox = computed(() => {
  const bounds = nodeBounds.value
  return {
    x: bounds.x - props.padding,
    y: bounds.y - props.padding,
    width: bounds.width + props.padding * 2,
    height: bounds.height + props.padding * 2,
  }
})

const scale = computed(() => {
  return Math.max(viewBox.value.width / props.width, viewBox.value.height / props.height, 0.001)
})

const maskRect = computed(() => ({
  x: -viewport.value.x / viewport.value.zoom,
  y: -viewport.value.y / viewport.value.zoom,
  width: dimensions.value.width / viewport.value.zoom,
  height: dimensions.value.height / viewport.value.zoom,
}))

const nodeRects = computed(() =>
  visibleNodes.value.map((node) => {
    const width = Number(node.dimensions?.width || node.width || 260)
    const height = Number(node.dimensions?.height || node.height || 430)
    return {
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      width,
      height,
      rx: node.type === 'frame' ? 8 : 4,
    }
  }),
)

const maskPath = computed(() => {
  const vb = viewBox.value
  const mask = maskRect.value
  const outer = `M${vb.x},${vb.y} h${vb.width} v${vb.height} h${-vb.width} z`
  const inner = `M${mask.x},${mask.y} h${mask.width} v${mask.height} h${-mask.width} z`
  return `${outer} ${inner}`
})
</script>

<template>
  <svg
    class="workflow-minimap"
    :viewBox="`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`"
    :width="width"
    :height="height"
    shape-rendering="crispEdges"
  >
    <rect
      v-for="rect in nodeRects"
      :key="rect.id"
      :x="rect.x"
      :y="rect.y"
      :width="rect.width"
      :height="rect.height"
      :rx="rect.rx"
      :fill="nodeColor"
      :stroke="nodeStrokeColor"
      stroke-width="1"
    />
    <path :d="maskPath" :fill="maskColor" fill-rule="evenodd" />
  </svg>
</template>

<style scoped>
.workflow-minimap {
  position: absolute;
  right: 16px;
  bottom: 16px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-card);
  pointer-events: none;
}
</style>
