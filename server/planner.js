import { randomUUID } from 'node:crypto'
import { describeWorkflowParameters, workflowParameters } from './workflow-parameters.js'

const nodeDefaults = {
  'reference-image': { name: 'Image Upload', config: { sourceType: 'Upload', reference: '', background: 'Keep', preview: '/shark-reference.png' } },
  prompt: { name: 'Text Prompt', config: { prompt: 'Production-ready stylized 3D asset', strength: 80 } },
  'generate-image': { name: 'Image to Image', config: { model: 'GPT Image 2', count: 4, aspectRatio: '1:1', referenceMode: 'Image + Prompt', previews: ['/shark-concept-front.png', '/shark-concept-left.png', '/shark-concept-right.png', '/shark-concept-back.png'] } },
  'generate-model': { name: 'Image to 3D', config: { modelVersion: 'Smart Mesh', textureMode: 'PBR', faceType: 'Triangle', faceCount: 20000, preview: '/shark-model.png' } },
  'text-to-3d': { name: 'Text to 3D', config: { modelVersion: 'Smart Mesh', textureMode: 'PBR', faceType: 'Triangle', faceCount: 20000, preview: '/shark-model.png' } },
  retopology: { name: 'Retopology', config: { modelVersion: 'v2.0', faceType: 'Triangle', faceLimit: 10000, bakeTextures: true, preview: '/shark-retopology.png' } },
  texture: { name: 'Texture Model', config: { model: 'Texture v2.0', resolution: '2K', style: 'Original', pbr: true, preview: '/shark-textured.png' } },
  'model-preview': { name: 'Review 3D Result', config: { environment: 'Studio', autoRotate: true, wireframe: false, preview: '/shark-review.png' } },
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

  return edges
}

function baseWorkflow(message) {
  const lower = message.toLowerCase()
  const name = lower.includes('prop') || message.includes('道具') ? 'Game Prop Pipeline' : '3D Asset Pipeline'
  const textTo3d = /text[ -]?to[ -]?3d|generate (?:a )?(?:3d )?model from (?:text|a prompt|a description)|文生3d|文字生成3d|文本生成3d|提示词生成3d|根据描述生成3d/i.test(message)
  const types = textTo3d
    ? ['prompt', 'text-to-3d', 'model-preview']
    : ['reference-image', 'prompt', 'generate-image', 'generate-model', 'model-preview']
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

function parameterHelpType(message) {
  if (/retopo|拓扑|减面/i.test(message)) return 'retopology'
  if (/texture|贴图|纹理/i.test(message)) return 'texture'
  if (/text[ -]?to[ -]?3d|文生3d/i.test(message)) return 'text-to-3d'
  if (/image[ -]?to[ -]?3d|图生3d/i.test(message)) return 'generate-model'
  if (/prompt|提示词/i.test(message)) return 'prompt'
  return null
}

function numberFrom(match) {
  if (!match) return null
  const value = Number(match[1].replaceAll(',', ''))
  return Number.isFinite(value) ? value : null
}

function setParameter(workflow, changes, type, field, value) {
  const node = workflow.nodes.find((candidate) => candidate.type === type)
  const definition = workflowParameters[type]?.fields[field]
  if (!node || !definition) return false
  if (definition.kind === 'number' && (value < definition.min || value > definition.max || value % definition.step !== 0)) return false
  if (definition.kind === 'enum' && !definition.values.includes(value)) return false
  const previousValue = node.config[field]
  if (previousValue === value) return true
  node.config = { ...node.config, [field]: value }
  changes.push({ nodeId: node.id, nodeLabel: workflowParameters[type].label, fieldLabel: definition.label, previousValue, value })
  return true
}

export function applyParameterChanges(message, workflow, changes) {
  const lower = message.toLowerCase()
  const retopoFaces = numberFrom(lower.match(/(?:retopo(?:logy)?|拓扑|减面)[^\d]{0,30}(\d[\d,]*)\s*(?:faces?|面)?/))
    ?? numberFrom(lower.match(/(?:face limit|target faces?|目标面数)[^\d]{0,12}(\d[\d,]*)/))
  if (retopoFaces !== null) setParameter(workflow, changes, 'retopology', 'faceLimit', retopoFaces)

  const retopoFaceType = lower.match(/(?:retopo(?:logy)?|拓扑|减面)[^.;；。]{0,50}(triangle|quad|三角面|四边面)/)?.[1]
    ?? lower.match(/(?:face type|面类型)[^.;；。]{0,12}(triangle|quad|三角面|四边面)/)?.[1]
  if (retopoFaceType) {
    setParameter(workflow, changes, 'retopology', 'faceType', /quad|四边面/.test(retopoFaceType) ? 'Quad' : 'Triangle')
  }

  const generatedFaces = numberFrom(lower.match(/(?:text[ -]?to[ -]?3d|image[ -]?to[ -]?3d|generate(?:d)?|生成)[^\d]{0,30}(\d[\d,]*)\s*(?:faces?|面)/))
    ?? numberFrom(lower.match(/(?:face count|生成面数)[^\d]{0,12}(\d[\d,]*)/))
  if (generatedFaces !== null) {
    const type = workflow.nodes.some((node) => node.type === 'text-to-3d') ? 'text-to-3d' : 'generate-model'
    setParameter(workflow, changes, type, 'faceCount', generatedFaces)
  }

  const resolution = lower.match(/\b(1k|2k|4k)\b/)?.[1]?.toUpperCase()
  if (resolution && /texture|resolution|贴图|纹理|分辨率/i.test(message)) setParameter(workflow, changes, 'texture', 'resolution', resolution)

  const strength = numberFrom(lower.match(/(?:prompt strength|提示词强度)[^\d]{0,12}(\d{1,3})\s*%?/))
  if (strength !== null) setParameter(workflow, changes, 'prompt', 'strength', strength)

  const version = lower.match(/\b(v(?:1\.0|2\.0|2\.5))\b/)?.[1]
  if (version) {
    const canonical = `v${version.slice(1)}`
    const type = /retopo|拓扑|减面/i.test(message)
      ? 'retopology'
      : workflow.nodes.some((node) => node.type === 'text-to-3d') ? 'text-to-3d' : 'generate-model'
    setParameter(workflow, changes, type, 'modelVersion', canonical)
  }
}

export function planWorkflow(message, existingWorkflow) {
  const lower = message.toLowerCase()
  const workflow = existingWorkflow ? structuredClone(existingWorkflow) : baseWorkflow(message)
  const changes = []
  const structuralChanges = []
  const helpRequest = existingWorkflow && /(?:what|which|show|list).*(?:parameters?|settings?)|(?:parameters?|settings?).*(?:available|adjust|change)|哪些?参数|参数.*(?:可以|能).*(?:调|改)|有什么.*参数/i.test(message)

  if (helpRequest) {
    const description = describeWorkflowParameters(workflow, parameterHelpType(message))
    return { workflow, reply: description || 'This workflow has no adjustable parameters.', changedNodeIds: [], structureChanged: false }
  }

  if (/低模|low[ -]?poly|retopo/.test(lower)) {
    if (insertBefore(workflow, 'retopology', ['texture', 'model-preview'])) structuralChanges.push(workflow.nodes.find((node) => node.type === 'retopology').id)
  }
  if (/贴图|texture|pbr/.test(lower)) {
    if (insertBefore(workflow, 'texture', ['model-preview'])) structuralChanges.push(workflow.nodes.find((node) => node.type === 'texture').id)
  }

  if (existingWorkflow) applyParameterChanges(message, workflow, changes)

  if (structuralChanges.length) workflow.edges = rebuildDagEdges(workflow.nodes)
  const didChange = !existingWorkflow || structuralChanges.length || changes.length
  if (existingWorkflow && didChange) workflow.revision += 1
  if (didChange) workflow.updatedAt = new Date().toISOString()

  const reply = existingWorkflow
    ? changes.length
      ? changes.map((change) => `${change.nodeLabel}: ${change.fieldLabel} ${change.previousValue} → ${change.value}`).join('\n')
      : structuralChanges.length
        ? `I added ${structuralChanges.length} requested workflow stage${structuralChanges.length === 1 ? '' : 's'}.`
        : 'I could not find a supported parameter change. Ask “What parameters can I adjust?” to see the available controls.'
    : `I created “${workflow.name}” as a reusable workflow. You can move nodes freely, edit the structure, and continue refining it through conversation.`

  return { workflow, reply, changedNodeIds: [...new Set([...structuralChanges, ...changes.map((change) => change.nodeId)])], structureChanged: structuralChanges.length > 0 }
}
