export const nodeCatalog = [
  { category: 'Input', type: 'reference-image', label: 'Image Upload', description: 'Add an image or asset input', inputTypes: [], outputType: 'image' },
  { category: 'Input', type: 'prompt', label: 'Text Prompt', description: 'Set creative direction', inputTypes: [], outputType: 'text' },
  { category: '2D', type: 'generate-image', label: 'Image to Image', description: 'Create concept images', inputTypes: ['image', 'text'], outputType: 'image' },
  { category: '3D', type: 'generate-model', label: 'Image to 3D', description: 'Turn images into a model', inputTypes: ['image'], outputType: 'model' },
  { category: '3D', type: 'text-to-3d', label: 'Text to 3D', description: 'Turn a text prompt into a model', inputTypes: ['text'], outputType: 'model' },
  { category: '3D', type: 'retopology', label: 'Retopology', description: 'Optimize model geometry', inputTypes: ['model'], outputType: 'model' },
  { category: '3D', type: 'texture', label: 'Texture Model', description: 'Generate PBR materials', inputTypes: ['model'], outputType: 'model' },
  { category: '3D', type: 'model-preview', label: 'Model preview', description: 'Review the 3D result', inputTypes: ['model'], outputType: 'model' },
  { category: '3D', type: 'save-asset', label: 'Save asset', description: 'Store in the asset library', inputTypes: ['model'], outputType: 'asset' },
  { category: '3D', type: 'export-model', label: 'Export Model', description: 'Deliver a production file', inputTypes: ['model', 'asset'], outputType: null },
]

const lycheeNodeNames = new Map([
  ['reference-image', 'Image Upload'],
  ['prompt', 'Text Prompt'],
  ['generate-image', 'Image to Image'],
  ['generate-model', 'Image to 3D'],
  ['text-to-3d', 'Text to 3D'],
  ['retopology', 'Retopology'],
  ['texture', 'Texture Model'],
  ['export-model', 'Export Model'],
])

export const nodeCategories = ['Input', '2D', '3D', 'Video']

export function nodeDefinition(type) {
  return nodeCatalog.find((item) => item.type === type)
}

export function nodeDisplayName(type, fallback) {
  return lycheeNodeNames.get(type) || fallback || type
}

export function canConnectNodeTypes(sourceType, targetType) {
  const source = nodeDefinition(sourceType)
  const target = nodeDefinition(targetType)
  return Boolean(source?.outputType && target?.inputTypes.includes(source.outputType))
}

export function compatibleNodeTypes(sourceType) {
  return nodeCatalog.filter((item) => canConnectNodeTypes(sourceType, item.type))
}
