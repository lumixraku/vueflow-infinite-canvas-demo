import test from 'node:test'
import assert from 'node:assert/strict'
import { canConnectNodeTypes, canConnectPorts, compatibleNodeTypes, nodeCatalog, nodeDisplayName } from './workflow-nodes.js'

test('uses Lychee node names while preserving unmatched node names', () => {
  assert.equal(nodeDisplayName('reference-image', 'Reference Image'), 'Image Upload')
  assert.equal(nodeDisplayName('prompt', 'Prompt'), 'Text Prompt')
  assert.equal(nodeDisplayName('generate-image', 'Generate Concept'), 'Gen Image')
  assert.equal(nodeDisplayName('generate-model', 'Generate 3D Model'), 'Gen Model')
  assert.equal(nodeDisplayName('text-to-3d', 'Generate 3D Model'), 'Text to 3D')
  assert.equal(nodeDisplayName('retopology', 'Low-poly Retopology'), 'Retopology')
  assert.equal(nodeDisplayName('texture', 'Generate PBR Texture'), 'Texture Model')
  assert.equal(nodeDisplayName('export-model', 'Export Model'), 'Export')
})

test('only allows compatible workflow media types', () => {
  assert.equal(canConnectNodeTypes('prompt', 'generate-image'), true)
  assert.equal(canConnectNodeTypes('reference-image', 'generate-image'), true)
  assert.equal(canConnectNodeTypes('generate-image', 'generate-model'), true)
  assert.equal(canConnectNodeTypes('generate-multiview-images', 'multiview-to-3d'), true)
  assert.equal(canConnectNodeTypes('prompt', 'text-to-3d'), true)
  assert.equal(canConnectNodeTypes('reference-image', 'text-to-3d'), false)
  assert.equal(canConnectNodeTypes('text-to-3d', 'texture'), true)
  assert.equal(canConnectNodeTypes('generate-model', 'texture'), true)
  assert.equal(canConnectNodeTypes('prompt', 'generate-model'), true)
  assert.equal(canConnectNodeTypes('generate-image', 'texture'), false)
  assert.equal(canConnectNodeTypes('unknown', 'prompt'), false)
})

test('connects multiview ports by media type', () => {
  assert.equal(canConnectPorts('generate-multiview-images', 'front', 'multiview-to-3d', 'front'), true)
  assert.equal(canConnectPorts('generate-multiview-images', 'back', 'multiview-to-3d', 'left'), true)
  assert.equal(canConnectPorts('generate-multiview-images', 'front', 'generated-image', 'image'), true)
  assert.equal(canConnectPorts('generated-image', 'image', 'multiview-to-3d', 'front'), true)
  assert.equal(canConnectPorts('reference-image', 'image', 'multiview-to-3d', 'right'), true)
  assert.equal(canConnectPorts('generate-multiview-images', 'front', 'multiview-to-3d', 'image'), false)
})

test('returns only nodes accepted by a dragged output', () => {
  assert.deepEqual(compatibleNodeTypes('prompt').map((node) => node.type), ['generate-image', 'generate-multiview-images', 'generate-model', 'smart-mesh'])
  assert.deepEqual(compatibleNodeTypes('generate-model').map((node) => node.type), ['retopology', 'bake', 'texture', 'rigging', 'split', 'model-preview', 'export-model'])
  assert.ok(!nodeCatalog.some((node) => ['save-asset'].includes(node.type)))
})
