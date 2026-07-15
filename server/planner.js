import { randomUUID } from 'node:crypto'

const nodeDefaults = {
  'reference-image': { name: 'Reference Image', config: { sourceType: 'Upload', reference: '', background: 'Keep', preview: '/shark-reference.png' } },
  prompt: { name: 'Refine Prompt', config: { prompt: 'Production-ready stylized 3D asset', strength: 80 } },
  'generate-image': { name: 'Generate Concept', config: { model: 'GPT Image 2', count: 4, aspectRatio: '1:1', referenceMode: 'Image + Prompt', previews: ['/shark-concept-front.png', '/shark-concept-left.png', '/shark-concept-right.png', '/shark-concept-back.png'] } },
  'generate-model': { name: 'Generate 3D Model', config: { modelVersion: 'Smart Mesh', textureMode: 'PBR', faceType: 'Triangle', faceCount: 20000, preview: '/shark-model.png' } },
  retopology: { name: 'Low-poly Retopology', config: { modelVersion: 'v2.0', faceType: 'Triangle', faceLimit: 10000, bakeTextures: true, preview: '/shark-retopology.png' } },
  texture: { name: 'Generate PBR Texture', config: { model: 'Texture v2.0', resolution: '2K', style: 'Original', pbr: true, preview: '/shark-textured.png' } },
  'model-preview': { name: 'Review 3D Result', config: { environment: 'Studio', background: '#202322', autoRotate: true, wireframe: false, preview: '/shark-review.png' } },
  'save-asset': { name: 'Save to Asset Library', config: { collection: 'Current project', tags: '', savePreview: true } },
  'export-model': { name: 'Export GLB', config: { format: 'glb', compression: 'Draco', includeTextures: true } },
}

function slug(type, nodes) {
  let id = type
  let index = 2
  while (nodes.some((node) => node.id === id)) id = `${type}-${index++}`
  return id
}

function createNode(type, nodes) {
  const id = slug(type, nodes)
  const previous = nodes.at(-1)
  return {
    id,
    type,
    name: nodeDefaults[type].name,
    config: structuredClone(nodeDefaults[type].config),
    ui: { position: { x: previous ? previous.ui.position.x + 340 : 0, y: previous?.ui.position.y ?? 120 } },
  }
}

function ports(sourceType, targetType) {
  if (sourceType === 'reference-image') return ['image', targetType === 'prompt' ? 'reference' : 'image']
  if (sourceType === 'prompt') return ['prompt', 'prompt']
  if (sourceType === 'generate-image') return ['image', 'image']
  if (sourceType === 'save-asset') return ['asset', 'asset']
  return ['model', 'model']
}

function rebuildLinearEdges(nodes) {
  return nodes.slice(1).map((node, index) => {
    const source = nodes[index]
    const [sourcePort, targetPort] = ports(source.type, node.type)
    return {
      id: `${source.id}-${node.id}`,
      source: { nodeId: source.id, port: sourcePort },
      target: { nodeId: node.id, port: targetPort },
    }
  })
}

function arrangeNodes(nodes) {
  const columns = 4
  nodes.forEach((node, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    node.ui.position = {
      x: (row % 2 ? columns - column - 1 : column) * 340,
      y: 120 + row * 430,
    }
  })
}

function baseWorkflow(message) {
  const lower = message.toLowerCase()
  const name = lower.includes('prop') || message.includes('道具') ? 'Game Prop Pipeline' : '3D Asset Pipeline'
  const types = ['reference-image', 'prompt', 'generate-image', 'generate-model', 'model-preview', 'export-model']
  const nodes = []
  for (const type of types) nodes.push(createNode(type, nodes))
  arrangeNodes(nodes)
  return {
    schemaVersion: '1.0',
    id: `wf-${randomUUID()}`,
    name,
    description: 'A reusable 3D production workflow created through conversation.',
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    inputs: [{ key: 'referenceImage', type: 'image', label: 'Reference image', required: true }],
    nodes,
    edges: rebuildLinearEdges(nodes),
    viewport: { x: 80, y: 160, zoom: 0.72 },
  }
}

function insertBefore(workflow, type, beforeTypes) {
  if (workflow.nodes.some((node) => node.type === type)) return false
  const node = createNode(type, workflow.nodes)
  const index = workflow.nodes.findIndex((candidate) => beforeTypes.includes(candidate.type))
  workflow.nodes.splice(index < 0 ? workflow.nodes.length : index, 0, node)
  arrangeNodes(workflow.nodes)
  return true
}

export function planWorkflow(message, existingWorkflow) {
  const lower = message.toLowerCase()
  const workflow = existingWorkflow ? structuredClone(existingWorkflow) : baseWorkflow(message)
  const changes = []

  if (/低模|low[ -]?poly|retopo/.test(lower)) {
    if (insertBefore(workflow, 'retopology', ['texture', 'model-preview', 'save-asset', 'export-model'])) changes.push('retopology')
  }
  if (/贴图|texture|pbr/.test(lower)) {
    if (insertBefore(workflow, 'texture', ['model-preview', 'save-asset', 'export-model'])) changes.push('texture')
  }
  if (/资产库|asset library|save asset/.test(lower)) {
    if (insertBefore(workflow, 'save-asset', ['export-model'])) changes.push('save-asset')
  }

  const format = ['fbx', 'obj', 'stl', 'usdz', 'glb'].find((candidate) => lower.includes(candidate))
  const exportNode = workflow.nodes.find((node) => node.type === 'export-model')
  if (format && exportNode) {
    exportNode.config.format = format
    exportNode.name = `Export ${format.toUpperCase()}`
    changes.push(exportNode.id)
  }

  workflow.edges = rebuildLinearEdges(workflow.nodes)
  if (existingWorkflow) workflow.revision += 1
  workflow.updatedAt = new Date().toISOString()

  const reply = existingWorkflow
    ? changes.length
      ? `I updated the workflow with ${changes.length} requested change${changes.length === 1 ? '' : 's'}. The workflow remains fully editable on the canvas.`
      : 'I reviewed the workflow. Try asking me to add low-poly retopology, PBR textures, asset saving, or a different export format.'
    : `I created “${workflow.name}” as a reusable workflow. You can move nodes freely, edit the structure, and continue refining it through conversation.`

  return { workflow, reply, changedNodeIds: changes }
}
