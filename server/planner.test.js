import test from 'node:test'
import assert from 'node:assert/strict'
import { planWorkflow } from './planner.js'

test('creates a reusable workflow', () => {
  const { workflow } = planWorkflow('Create a game character workflow')
  assert.equal(workflow.schemaVersion, '1.0')
  assert.equal(workflow.nodes.length, 5)
  assert.equal(workflow.edges.length, 4)
  assert.deepEqual(workflow.nodes.find((node) => node.type === 'generate-model').config, {
    modelVersion: 'Smart Mesh',
    textureMode: 'PBR',
    faceType: 'Triangle',
    faceCount: 20000,
    preview: '/shark-model.png',
  })
  assert.equal(workflow.nodes.find((node) => node.type === 'generate-image').config.model, 'GPT Image 2')
  assert.equal(workflow.nodes.find((node) => node.type === 'generate-image').config.previews.length, 4)
  assert.deepEqual(Object.fromEntries(workflow.nodes.map((node) => [node.type, node.name])), {
    'reference-image': 'Image Upload',
    prompt: 'Text Prompt',
    'generate-image': 'Image to Image',
    'generate-model': 'Image to 3D',
    'model-preview': 'Review 3D Result',
  })
  assert.deepEqual(workflow.edges.map((edge) => [edge.source.nodeId, edge.target.nodeId]), [
    ['reference-image', 'generate-image'],
    ['prompt', 'generate-image'],
    ['generate-image', 'generate-model'],
    ['generate-model', 'model-preview'],
  ])
})

test('creates a dedicated Text to 3D workflow', () => {
  const { workflow } = planWorkflow('Create a text-to-3D workflow from a prompt')

  assert.deepEqual(workflow.nodes.map((node) => [node.type, node.name]), [
    ['prompt', 'Text Prompt'],
    ['text-to-3d', 'Text to 3D'],
    ['model-preview', 'Review 3D Result'],
  ])
  assert.deepEqual(workflow.edges.map((edge) => [edge.source.nodeId, edge.target.nodeId]), [
    ['prompt', 'text-to-3d'],
    ['text-to-3d', 'model-preview'],
  ])
  assert.deepEqual(workflow.inputs, [{ key: 'prompt', type: 'text', label: 'Text prompt', required: true }])
  assert.equal(workflow.nodes.find((node) => node.type === 'text-to-3d').config.modelVersion, 'Smart Mesh')
})

test('recognizes Chinese Text to 3D requests', () => {
  const { workflow } = planWorkflow('根据描述生成3D工作流')
  assert.ok(workflow.nodes.some((node) => node.type === 'text-to-3d'))
  assert.ok(!workflow.nodes.some((node) => node.type === 'generate-model'))
})

test('adds requested stages without duplicates', () => {
  const initial = planWorkflow('Create a prop workflow').workflow
  const first = planWorkflow('Add low-poly and PBR texture', initial).workflow
  const second = planWorkflow('Add low-poly again', first).workflow
  assert.equal(first.nodes.filter((node) => node.type === 'retopology').length, 1)
  assert.equal(first.nodes.filter((node) => node.type === 'texture').length, 1)
  assert.equal(second.nodes.filter((node) => node.type === 'retopology').length, 1)
  assert.equal(first.nodes.find((node) => node.type === 'retopology').name, 'Retopology')
  assert.equal(first.nodes.find((node) => node.type === 'texture').name, 'Texture Model')
  assert.ok(first.nodes.every((node) => Number.isFinite(node.ui.position.x) && Number.isFinite(node.ui.position.y)))
  assert.equal(first.nodes.find((node) => node.type === 'retopology').config.bakeTextures, true)
  assert.equal(first.nodes.find((node) => node.type === 'texture').config.resolution, '2K')
  assert.deepEqual(first.edges.map((edge) => [edge.source.nodeId, edge.target.nodeId]), [
    ['reference-image', 'generate-image'],
    ['prompt', 'generate-image'],
    ['generate-image', 'generate-model'],
    ['generate-model', 'retopology'],
    ['retopology', 'texture'],
    ['texture', 'model-preview'],
  ])
})

test('ends processed models at preview', () => {
  const initial = planWorkflow('Create a prop workflow').workflow
  const { workflow } = planWorkflow('Add low-poly, PBR texture, save to asset library, and export FBX', initial)
  const incoming = (id) => workflow.edges.filter((edge) => edge.target.nodeId === id)
  const outgoing = (id) => workflow.edges.filter((edge) => edge.source.nodeId === id)

  assert.deepEqual(workflow.nodes.filter((node) => incoming(node.id).length === 0).map((node) => node.id), ['reference-image', 'prompt'])
  assert.deepEqual(workflow.nodes.filter((node) => outgoing(node.id).length === 0).map((node) => node.id), ['model-preview'])
  assert.equal(incoming('generate-image').length, 2)
  assert.equal(outgoing('texture').length, 1)
  assert.deepEqual(workflow.edges.at(-1), {
    id: 'texture-model-preview',
    source: { nodeId: 'texture', port: 'model' },
    target: { nodeId: 'model-preview', port: 'model' },
  })
  assert.ok(!workflow.nodes.some((node) => ['save-asset', 'export-model'].includes(node.type)))
})
