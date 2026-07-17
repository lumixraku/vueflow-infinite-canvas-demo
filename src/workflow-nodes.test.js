import test from 'node:test'
import assert from 'node:assert/strict'
import { canConnectNodeTypes, compatibleNodeTypes, nodeDisplayName } from './workflow-nodes.js'

test('uses Lychee node names while preserving unmatched node names', () => {
  assert.equal(nodeDisplayName('reference-image', 'Reference Image'), 'Image Upload')
  assert.equal(nodeDisplayName('prompt', 'Prompt'), 'Text Prompt')
  assert.equal(nodeDisplayName('generate-image', 'Generate Concept'), 'Image to Image')
  assert.equal(nodeDisplayName('generate-model', 'Generate 3D Model'), 'Image to 3D')
  assert.equal(nodeDisplayName('retopology', 'Low-poly Retopology'), 'Retopology')
  assert.equal(nodeDisplayName('texture', 'Generate PBR Texture'), 'Texture Model')
  assert.equal(nodeDisplayName('export-model', 'Export FBX'), 'Export Model')
  assert.equal(nodeDisplayName('model-preview', 'Review 3D Result'), 'Review 3D Result')
  assert.equal(nodeDisplayName('save-asset', 'Save to Asset Library'), 'Save to Asset Library')
})

test('only allows compatible workflow media types', () => {
  assert.equal(canConnectNodeTypes('prompt', 'generate-image'), true)
  assert.equal(canConnectNodeTypes('reference-image', 'generate-image'), true)
  assert.equal(canConnectNodeTypes('generate-image', 'generate-model'), true)
  assert.equal(canConnectNodeTypes('generate-model', 'texture'), true)
  assert.equal(canConnectNodeTypes('prompt', 'generate-model'), false)
  assert.equal(canConnectNodeTypes('generate-image', 'texture'), false)
  assert.equal(canConnectNodeTypes('export-model', 'prompt'), false)
})

test('returns only nodes accepted by a dragged output', () => {
  assert.deepEqual(compatibleNodeTypes('prompt').map((node) => node.type), ['generate-image'])
  assert.ok(compatibleNodeTypes('generate-model').some((node) => node.type === 'export-model'))
})
