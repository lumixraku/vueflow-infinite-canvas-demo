import test from 'node:test'
import assert from 'node:assert/strict'
import { canConnectNodeTypes, compatibleNodeTypes } from './workflow-nodes.js'

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
