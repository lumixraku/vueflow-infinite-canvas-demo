<script setup>
import { computed } from 'vue'
import { ColorSliderRoot, ColorSliderThumb, ColorSliderTrack } from 'reka-ui'

const props = defineProps({ modelValue: { type: String, required: true } })
const emit = defineEmits(['update:model-value'])
const color = computed(() => props.modelValue || '#202322')

function updateHex(event) {
  const value = event.target.value.trim()
  if (/^#[\da-f]{6}$/i.test(value)) emit('update:model-value', value)
  else event.target.value = color.value
}
</script>

<template>
  <div class="node-color-picker nodrag">
    <ColorSliderRoot class="node-color-slider" color-space="hsl" channel="hue" :model-value="color" @update:model-value="emit('update:model-value', $event)">
      <ColorSliderTrack class="node-color-track"><ColorSliderThumb class="node-color-thumb" /></ColorSliderTrack>
    </ColorSliderRoot>
    <span class="node-color-swatch" :style="{ backgroundColor: color }" />
    <input class="node-color-value" :value="color" maxlength="7" aria-label="Background color hex value" @change="updateHex" />
  </div>
</template>
