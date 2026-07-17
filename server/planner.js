import { randomUUID } from 'node:crypto'

const nodeDefaults = {
  'reference-image': { name: 'Image Upload', config: { sourceType: 'Upload', reference: '', background: 'Keep', preview: '/shark-reference.png' } },
  prompt: { name: 'Text Prompt', config: { prompt: 'Production-ready stylized 3D asset', strength: 80 } },
  'generate-image': { name: 'Image to Image', config: { model: 'GPT Image 2', count: 4, aspectRatio: '1:1', referenceMode: 'Image + Prompt', previews: ['/shark-concept-front.png', '/shark-concept-left.png', '/shark-concept-right.png', '/shark-concept-back.png'] } },
  'generate-model': { name: 'Image to 3D', config: { modelVersion: 'Smart Mesh', textureMode: 'PBR', faceType: 'Triangle', faceCount: 20000, preview: '/shark-model.png' } },
  'text-to-3d': { name: 'Text to 3D', config: { modelVersion: 'Smart Mesh', textureMode: 'PBR', faceType: 'Triangle', faceCount: 20000, preview: '/shark-model.png' } },
  retopology: { name: 'Retopology', config: { modelVersion: 'v2.0', faceType: 'Triangle', faceLimit: 10000, bakeTextures: true, preview: '/shark-retopology.png' } },
  texture: { name: 'Texture Model', config: { model: 'Texture v2.0', resolution: '2K', style: 'Original', pbr: true, preview: '/shark-textured.png' } },
  'model-preview': { name: 'Review 3D Result', config: { environment: 'Studio', background: '#202322', autoRotate: true, wireframe: false, preview: '/shark-review.png' } },
  'save-asset': { name: 'Save to Asset Library', config: { collection: 'Current project', tags: '', savePreview: true } },
  'export-model': { name: 'Export Model', config: { format: 'glb', compression: 'Draco', includeTextures: true } },
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

function rebuildDagEdges(nodes) {
  const byType = new Map(nodes.map((node) => [node.type, node]))
  const edges = []
  const connect = (sourceType, sourcePort, targetType, targetPort) => {
    const source = byType.get(sourceType)
    const target = byType.get(targetType)
    if (!source || !target) return
    edges.push({
      id: `${source.id}-${target.id}`,
      source: { nodeId: source.id, port: sourcePort },
      target: { nodeId: target.id, port: targetPort },
    })
  }

  connect('reference-image', 'image', 'generate-image', 'image')
  connect('prompt', 'prompt', 'generate-image', 'prompt')
  connect('generate-image', 'image', 'generate-model', 'image')
  connect('prompt', 'text', 'text-to-3d', 'text')

  const modelSource = byType.has('text-to-3d') ? 'text-to-3d' : 'generate-model'
  const modelChain = [modelSource, 'retopology', 'texture'].filter((type) => byType.has(type))
  modelChain.slice(1).forEach((type, index) => connect(modelChain[index], 'model', type, 'model'))
  const finalModelType = modelChain.at(-1)
  connect(finalModelType, 'model', 'model-preview', 'model')
  if (byType.has('save-asset')) {
    connect(finalModelType, 'model', 'save-asset', 'model')
    connect('save-asset', 'asset', 'export-model', 'asset')
  } else {
    connect(finalModelType, 'model', 'export-model', 'model')
  }

  return edges
}

function baseWorkflow(message) {
  const lower = message.toLowerCase()
  const name = lower.includes('prop') || message.includes('道具') ? 'Game Prop Pipeline' : '3D Asset Pipeline'
  const textTo3d = /text[ -]?to[ -]?3d|generate (?:a )?(?:3d )?model from (?:text|a prompt|a description)|文生3d|文字生成3d|文本生成3d|提示词生成3d|根据描述生成3d/i.test(message)
  const types = textTo3d
    ? ['prompt', 'text-to-3d', 'model-preview', 'export-model']
    : ['reference-image', 'prompt', 'generate-image', 'generate-model', 'model-preview', 'export-model']
  const nodes = []
  for (const type of types) nodes.push(createNode(type, nodes))
  return {
    schemaVersion: '1.0',
    id: `wf-${randomUUID()}`,
    name,
    description: 'A reusable 3D production workflow created through conversation.',
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    inputs: textTo3d
      ? [{ key: 'prompt', type: 'text', label: 'Text prompt', required: true }]
      : [{ key: 'referenceImage', type: 'image', label: 'Reference image', required: true }],
    nodes,
    edges: rebuildDagEdges(nodes),
    viewport: { x: 80, y: 160, zoom: 0.72 },
  }
}

function insertBefore(workflow, type, beforeTypes) {
  if (workflow.nodes.some((node) => node.type === type)) return false
  const node = createNode(type, workflow.nodes)
  const index = workflow.nodes.findIndex((candidate) => beforeTypes.includes(candidate.type))
  workflow.nodes.splice(index < 0 ? workflow.nodes.length : index, 0, node)
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
    changes.push(exportNode.id)
  }

  workflow.edges = rebuildDagEdges(workflow.nodes)
  if (existingWorkflow) workflow.revision += 1
  workflow.updatedAt = new Date().toISOString()

  const reply = existingWorkflow
    ? changes.length
      ? `I updated the workflow with ${changes.length} requested change${changes.length === 1 ? '' : 's'}. The workflow remains fully editable on the canvas.`
      : 'I reviewed the workflow. Try asking me to add low-poly retopology, PBR textures, asset saving, or a different export format.'
    : `I created “${workflow.name}” as a reusable workflow. You can move nodes freely, edit the structure, and continue refining it through conversation.`

  return { workflow, reply, changedNodeIds: changes }
}
