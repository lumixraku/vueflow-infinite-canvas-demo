import assert from 'node:assert/strict'
import test from 'node:test'
import { createInitialConversation, createWorkflow } from './workflows.js'

const node = (id, x = 0) => ({ id, type: 'prompt', name: id, config: {}, ui: { position: { x, y: 0 } } })

test('creates a workflow and initial conversation with server-owned fields', () => {
  const workflow = createWorkflow({
    id: 'caller-id',
    revision: 99,
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
    name: ' Selected workflow ',
    nodes: [node('a'), node('b', 300)],
    edges: [{ id: 'a-b', source: { nodeId: 'a', port: 'text' }, target: { nodeId: 'b', port: 'input' } }],
  })
  const conversation = createInitialConversation(workflow)

  assert.match(workflow.id, /^wf-/)
  assert.notEqual(workflow.id, 'caller-id')
  assert.equal(workflow.name, 'Selected workflow')
  assert.equal(workflow.revision, 1)
  assert.notEqual(workflow.createdAt, '2000-01-01T00:00:00.000Z')
  assert.equal(workflow.updatedAt, workflow.createdAt)
  assert.equal(conversation.workflowId, workflow.id)
  assert.equal(conversation.messages.length, 1)
})

test('requires a name and accepts an empty canvas', () => {
  assert.throws(() => createWorkflow({ name: ' ', nodes: [node('a')] }), /name is required/)
  const workflow = createWorkflow({ name: 'Empty', nodes: [], edges: [] })
  assert.deepEqual(workflow.nodes, [])
  assert.deepEqual(workflow.edges, [])
})

test('rejects duplicate node IDs and dangling edges', () => {
  assert.throws(() => createWorkflow({ name: 'Duplicate', nodes: [node('a'), node('a')] }), /must be unique/)
  assert.throws(() => createWorkflow({
    name: 'Dangling',
    nodes: [node('a')],
    edges: [{ id: 'a-missing', source: { nodeId: 'a', port: 'text' }, target: { nodeId: 'missing', port: 'input' } }],
  }), /inside the workflow/)
})
