import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeNodeRuns } from './node-runs.js'

test('executing a downstream node preserves upstream node output', () => {
  const textTo3d = {
    status: 'succeeded',
    durationMs: 650,
    output: { message: 'Text to 3D generated', preview: '/model.png' },
    error: null,
  }
  const retopology = {
    status: 'succeeded',
    durationMs: 650,
    output: { message: 'Retopology generated', preview: '/retopology.png' },
    error: null,
  }

  const afterTextTo3d = mergeNodeRuns({}, { 'text-to-3d': textTo3d })
  const afterRetopology = mergeNodeRuns(afterTextTo3d, { retopology })

  assert.equal(afterRetopology['text-to-3d'], textTo3d)
  assert.equal(afterRetopology.retopology, retopology)
})

test('regenerating a node replaces only that node output', () => {
  const current = {
    'text-to-3d': { status: 'succeeded', output: { preview: '/model.png' } },
    retopology: { status: 'succeeded', output: { preview: '/old.png' } },
  }
  const next = mergeNodeRuns(current, {
    retopology: { status: 'running', output: null },
  })

  assert.equal(next['text-to-3d'], current['text-to-3d'])
  assert.deepEqual(next.retopology, { status: 'running', output: null })
})
