export const nodeCatalog = [
  { category: 'Annotate', type: 'frame', label: 'Frame', description: 'Group related workflow steps', inputTypes: [], outputType: null },
  { category: 'Input', type: 'reference-image', label: 'Image Upload', description: 'Add an image or asset input', inputTypes: [], outputType: 'image' },
  { category: 'Input', type: 'generated-image', label: 'Generated Image', description: 'An image created by a workflow step', inputTypes: ['image'], outputType: 'image' },
  { category: 'Input', type: 'prompt', label: 'Text Prompt', description: 'Set creative direction', inputTypes: [], outputType: 'text' },
  { category: '2D', type: 'generate-image', label: 'Image to Image', description: 'Create concept images', inputTypes: ['image', 'text'], outputType: 'image' },
  {
    category: '2D',
    type: 'generate-multiview-images',
    label: 'Generate Multi-view Images',
    description: 'Create front, back, left, and right views from references',
    inputTypes: ['image', 'text'],
    outputType: null,
    outputPorts: multiViewPorts(),
  },
  { category: 'Annotate', type: 'review', label: 'Human Review', description: 'Pause for image approval before 3D generation', inputTypes: ['image'], outputType: 'image' },
  { category: '3D', type: 'generate-model', label: 'Image to 3D', description: 'Turn images into a model', inputTypes: ['image'], outputType: 'model' },
  {
    category: '3D',
    type: 'multiview-to-3d',
    label: 'Multi-view to 3D',
    description: 'Turn four labeled image views into a 3D model',
    inputTypes: [],
    outputType: 'model',
    inputPorts: multiViewPorts(),
  },
  { category: '3D', type: 'text-to-3d', label: 'Text to 3D', description: 'Turn a text prompt into a model', inputTypes: ['text'], outputType: 'model' },
  { category: '3D', type: 'retopology', label: 'Retopology', description: 'Optimize model geometry', inputTypes: ['model'], outputType: 'model' },
  { category: '3D', type: 'texture', label: 'Texture Model', description: 'Generate PBR materials', inputTypes: ['model'], outputType: 'model' },
  { category: '3D', type: 'model-preview', label: 'Model preview', description: 'Review the 3D result', inputTypes: ['model'], outputType: 'model' },
]

function multiViewPorts() {
  return ['front', 'back', 'left', 'right'].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), type: 'image' }))
}

const lycheeNodeNames = new Map([
  ['reference-image', 'Image Upload'],
  ['generated-image', 'Generated Image'],
  ['prompt', 'Text Prompt'],
  ['generate-image', 'Image to Image'],
  ['generate-multiview-images', 'Generate Multi-view Images'],
  ['generate-model', 'Image to 3D'],
  ['multiview-to-3d', 'Multi-view to 3D'],
  ['review', 'Human Review'],
  ['text-to-3d', 'Text to 3D'],
  ['retopology', 'Retopology'],
  ['texture', 'Texture Model'],
])

export const nodeCategories = ['Annotate', 'Input', '2D', '3D', 'Video']

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
  return nodeCatalog.filter((item) => canConnectNodeTypes(sourceType, item.type))
}
