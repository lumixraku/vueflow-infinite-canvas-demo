export const nodeCatalog = [
  { category: 'Annotate', type: 'frame', label: 'Frame', description: 'Group related workflow steps', inputTypes: [], outputType: null },
  { category: 'Input', type: 'reference-image', label: 'Image Upload', description: 'Add an image or asset input', inputTypes: [], outputType: 'image' },
  { category: 'Output', type: 'generated-image', label: 'Image', description: 'An image created by a workflow step', inputTypes: ['image'], outputType: 'image' },
  { category: 'Input', type: 'prompt', label: 'Text Prompt', description: 'Set creative direction', inputTypes: [], outputType: 'text' },
  { category: '2D', type: 'generate-image', label: 'Gen Image', description: 'Create concept images', inputTypes: ['image', 'text'], outputType: 'image' },
  {
    category: '2D',
    type: 'generate-multiview-images',
    label: 'Generate Multi-view Images',
    description: 'Create front, back, left, and right views from references',
    inputTypes: ['image', 'text'],
    outputType: null,
    outputPorts: multiViewPorts(),
  },
  { category: 'Annotate', type: 'review', label: 'Check', description: 'Pause to check the image before continuing', inputTypes: ['image'], outputType: 'image' },
  { category: '3D', type: 'generate-model', label: 'Gen Model', description: 'Turn an image or text prompt into a model', inputTypes: ['image', 'text'], outputType: 'model' },
  {
    category: '3D',
    type: 'multiview-to-3d',
    label: 'Multi-view to 3D',
    description: 'Turn four labeled image views into a 3D model',
    inputTypes: [],
    outputType: 'model',
    inputPorts: multiViewPorts(),
  },
  { category: '3D', type: 'text-to-3d', label: 'Text to 3D', description: 'Turn a text prompt into a model', inputTypes: ['text'], outputType: 'model', hidden: true },
  { category: '3D', type: 'retopology', label: 'Retopology', description: 'Optimize model geometry', inputTypes: ['model'], outputType: 'model' },
  { category: '3D', type: 'texture', label: 'Texture Model', description: 'Generate PBR materials', inputTypes: ['model'], outputType: 'model' },
  { category: '3D', type: 'model-preview', label: 'Model preview', description: 'Review the 3D result', inputTypes: ['model'], outputType: 'model' },
  { category: '3D', type: 'export-model', label: 'Export', description: 'Export an image or 3D model', inputTypes: ['image', 'model'], outputType: null },
]

function multiViewPorts() {
  return ['front', 'back', 'left', 'right'].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), type: 'image' }))
}

const lycheeNodeNames = new Map([
  ['reference-image', 'Image Upload'],
  ['generated-image', 'Image'],
  ['prompt', 'Text Prompt'],
  ['generate-image', 'Gen Image'],
  ['generate-multiview-images', 'Generate Multi-view Images'],
  ['generate-model', 'Gen Model'],
  ['multiview-to-3d', 'Multi-view to 3D'],
  ['review', 'Check'],
  ['text-to-3d', 'Text to 3D'],
  ['retopology', 'Retopology'],
  ['texture', 'Texture Model'],
  ['export-model', 'Export'],
])

export const nodeCategories = ['Annotate', 'Input', '2D', '3D', 'Output', 'Video']

export function nodeDefinition(type) {
  return nodeCatalog.find((item) => item.type === type)
}

export function nodeDisplayName(type, fallback) {
  return lycheeNodeNames.get(type) || fallback || type
}

export function canConnectNodeTypes(sourceType, targetType) {
  return nodeOutputPorts(sourceType).some((sourcePort) => nodeInputPorts(targetType).some((targetPort) => sourcePort.type === targetPort.type))
}

export function nodeInputPorts(type) {
  const definition = nodeDefinition(type)
  return definition?.inputPorts || definition?.inputTypes?.map((portType) => ({ id: portType, label: portType, type: portType })) || []
}

export function nodeOutputPorts(type) {
  const definition = nodeDefinition(type)
  return definition?.outputPorts || (definition?.outputType ? [{ id: definition.outputType, label: definition.outputType, type: definition.outputType }] : [])
}

export function canConnectPorts(sourceType, sourcePortId, targetType, targetPortId) {
  const sourcePort = nodeOutputPorts(sourceType).find((port) => port.id === sourcePortId)
  const targetPort = nodeInputPorts(targetType).find((port) => port.id === targetPortId)
  return Boolean(sourcePort && targetPort && sourcePort.type === targetPort.type)
}

export function compatibleNodeTypes(sourceType) {
  return nodeCatalog.filter((item) => !item.hidden && canConnectNodeTypes(sourceType, item.type))
}
