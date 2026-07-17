import test from 'node:test'
import assert from 'node:assert/strict'
import { planWorkflow } from './planner.js'

test('creates a reusable workflow', () => {
  const { workflow } = planWorkflow('Create a game character workflow')
  assert.equal(workflow.schemaVersion, '1.0')
  assert.equal(workflow.nodes.length, 6)
  assert.equal(workflow.edges.length, 5)
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
    'export-model': 'Export Model',
  })
  assert.deepEqual(workflow.edges.map((edge) => [edge.source.nodeId, edge.target.nodeId]), [
    ['reference-image', 'generate-image'],
    ['prompt', 'generate-image'],
    ['generate-image', 'generate-model'],
    ['generate-model', 'model-preview'],
    ['generate-model', 'export-model'],
  ])
})

test('adds requested stages without duplicates', () => {
  const initial = planWorkflow('Create a prop workflow').workflow
  const first = planWorkflow('Add low-poly and PBR texture, export FBX', initial).workflow
  const second = planWorkflow('Add low-poly again', first).workflow
  assert.equal(first.nodes.filter((node) => node.type === 'retopology').length, 1)
  assert.equal(first.nodes.filter((node) => node.type === 'texture').length, 1)
  assert.equal(second.nodes.filter((node) => node.type === 'retopology').length, 1)
  assert.equal(first.nodes.find((node) => node.type === 'export-model').config.format, 'fbx')
  assert.equal(first.nodes.find((node) => node.type === 'export-model').name, 'Export Model')
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
    ['texture', 'export-model'],
  ])
})

test('branches processed models to preview and asset delivery outputs', () => {
  const initial = planWorkflow('Create a prop workflow').workflow
  const { workflow } = planWorkflow('Add low-poly, PBR texture, save to asset library, and export FBX', initial)
  const incoming = (id) => workflow.edges.filter((edge) => edge.target.nodeId === id)
  const outgoing = (id) => workflow.edges.filter((edge) => edge.source.nodeId === id)

  assert.deepEqual(workflow.nodes.filter((node) => incoming(node.id).length === 0).map((node) => node.id), ['reference-image', 'prompt'])
  assert.deepEqual(workflow.nodes.filter((node) => outgoing(node.id).length === 0).map((node) => node.id), ['model-preview', 'export-model'])
  assert.equal(incoming('generate-image').length, 2)
  assert.equal(outgoing('texture').length, 2)
  assert.deepEqual(workflow.edges.slice(-3).map((edge) => [edge.source.nodeId, edge.target.nodeId]), [
    ['texture', 'model-preview'],
    ['texture', 'save-asset'],
    ['save-asset', 'export-model'],
  ])
})
