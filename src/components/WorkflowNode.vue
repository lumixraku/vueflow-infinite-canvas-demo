<script setup>
import { Handle, Position } from '@vue-flow/core'

defineProps({ data: { type: Object, required: true }, selected: Boolean })
</script>

<template>
  <article class="workflow-node" :class="[`tone-${data.tone}`, { selected }]">
    <Handle id="input" type="target" :position="Position.Left" />
    <header><span class="node-kind">{{ data.kind }}</span><span class="node-status" :class="data.status">{{ data.status }}</span></header>
    <div class="node-icon">{{ data.kind.slice(0, 1) }}</div>
    <h3>{{ data.label }}</h3>
    <p>{{ data.detail }}</p>
    <footer><span>{{ data.meta }}</span><span class="node-pulse" /></footer>
    <Handle id="output" type="source" :position="Position.Right" />
  </article>
</template>
