import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeRun } from './run-summary.js'

const nodes = [
  { id: 'model', data: { label: 'Text to 3D' } },
  { id: 'texture', data: { label: 'Texture' } },
  { id: 'unrelated', data: { label: 'Unrelated' } },
]

test('summarizes only the nodes included in a run', () => {
  const summary = summarizeRun({
    id: 'run-1',
    status: 'succeeded',
    nodeRuns: {
      model: { status: 'succeeded', durationMs: 650, output: { message: 'Model generated' }, error: null },
      texture: { status: 'succeeded', durationMs: 650, output: { message: 'Texture generated' }, error: null },
    },
  }, nodes)

  assert.equal(summary.total, 2)
  assert.equal(summary.completed, 2)
  assert.equal(summary.totalDurationMs, 1300)
  assert.deepEqual(summary.steps.map((step) => step.id), ['model', 'texture'])
})

test('uses a failed node error as its summary message', () => {
  const summary = summarizeRun({
    id: 'run-2',
    status: 'failed',
    nodeRuns: { model: { status: 'failed', durationMs: 650, output: null, error: 'Model execution failed' } },
  }, nodes)

  assert.equal(summary.completed, 1)
  assert.equal(summary.steps[0].message, 'Model execution failed')
})
