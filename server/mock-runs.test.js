import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createMockRun, executeMockRun, executionNodes, isRunTerminal } from './mock-runs.js'

const workflow = {
  id: 'wf-test',
  revision: 3,
  nodes: [
    { id: 'prompt', type: 'prompt', name: 'Text Prompt', config: {} },
    { id: 'model', type: 'text-to-3d', name: 'Text to 3D', config: { preview: '/model.png' } },
  ],
  edges: [
    { source: { nodeId: 'prompt' }, target: { nodeId: 'model' } },
  ],
}

test('creates a running mock run with stable node result shapes', () => {
  const run = createMockRun(workflow, { id: 'run-test', now: () => 'start' })

  assert.equal(run.status, 'running')
  assert.equal(run.completedAt, null)
  assert.deepEqual(run.nodeRuns.prompt, { status: 'running', durationMs: null, output: null, error: null })
  assert.deepEqual(run.nodeRuns.model, { status: 'queued', durationMs: null, output: null, error: null })
})

test('executes nodes in order and returns runtime preview output', async () => {
  const run = createMockRun(workflow, { id: 'run-test', now: () => 'start' })
  const transitions = []
  await executeMockRun(run, workflow, {
    wait: async () => {},
    now: () => 'complete',
    persist: async () => transitions.push(workflow.nodes.map((node) => run.nodeRuns[node.id].status)),
  })

  assert.equal(run.status, 'succeeded')
  assert.equal(run.completedAt, 'complete')
  assert.equal(run.nodeRuns.prompt.output.message, 'Mock prompt result')
  assert.deepEqual(run.nodeRuns.model.output, { message: 'Text to 3D generated', preview: '/model.png' })
  assert.ok(transitions.some((statuses) => statuses[0] === 'succeeded' && statuses[1] === 'running'))
  assert.equal(isRunTerminal(run), true)
})

test('derives execution order from workflow edges', () => {
  const reversed = { ...workflow, nodes: [...workflow.nodes].reverse() }
  assert.deepEqual(executionNodes(reversed).map((node) => node.id), ['prompt', 'model'])
})

test('executes the complete seeded production pipeline', async () => {
  const [seedWorkflow] = JSON.parse(await readFile(new URL('./seed/workflows.json', import.meta.url), 'utf8'))
  const run = createMockRun(seedWorkflow)
  await executeMockRun(run, seedWorkflow, { wait: async () => {}, persist: async () => {} })

  assert.deepEqual(executionNodes(seedWorkflow).map((node) => node.id), [
    'prompt', 'text-to-3d', 'retopology', 'texture', 'preview',
  ])
  assert.equal(Object.keys(run.nodeRuns).length, 5)
  assert.ok(Object.values(run.nodeRuns).every((nodeRun) => nodeRun.status === 'succeeded'))
})

test('creates and executes a run containing only the requested node', async () => {
  const executionWorkflow = { ...workflow, nodes: [workflow.nodes[1]] }
  const run = createMockRun(executionWorkflow, { id: 'run-target', now: () => 'start' })

  assert.deepEqual(Object.keys(run.nodeRuns), ['model'])
  await executeMockRun(run, executionWorkflow, { wait: async () => {}, now: () => 'complete', persist: async () => {} })
  assert.equal(run.status, 'succeeded')
  assert.deepEqual(Object.keys(run.nodeRuns), ['model'])
  assert.deepEqual(run.nodeRuns.model.output, { message: 'Text to 3D generated', preview: '/model.png' })
})

test('stops at a deterministic mocked node failure', async () => {
  const failingWorkflow = structuredClone(workflow)
  failingWorkflow.nodes[1].config.mockFailure = true
  const run = createMockRun(failingWorkflow)
  await executeMockRun(run, failingWorkflow, { wait: async () => {}, now: () => 'failed', persist: async () => {} })

  assert.equal(run.status, 'failed')
  assert.equal(run.nodeRuns.model.status, 'failed')
  assert.equal(run.nodeRuns.model.output, null)
  assert.match(run.nodeRuns.model.error, /execution failed/)
})
