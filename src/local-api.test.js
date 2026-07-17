import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalApi } from './local-api.js'

function createMemoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

test('initializes and persists workflows in local storage', async () => {
  const storage = createMemoryStorage()
  const request = createLocalApi({ storage, origin: 'https://demo.test' })
  const workflows = await request('/api/workflows')
  const detail = await request(`/api/workflows/${workflows[0].id}`)
  detail.workflow.name = 'Locally saved workflow'
  await request(`/api/workflows/${detail.workflow.id}`, { method: 'PUT', body: JSON.stringify(detail.workflow) })

  const reloadedRequest = createLocalApi({ storage, origin: 'https://demo.test' })
  const reloaded = await reloadedRequest(`/api/workflows/${detail.workflow.id}`)
  assert.equal(reloaded.workflow.name, 'Locally saved workflow')
})

test('creates chat workflows and fragments without sharing mutable state', async () => {
  const storage = createMemoryStorage()
  const request = createLocalApi({ storage, origin: 'https://demo.test' })
  const chat = await request('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'Create a low poly PBR prop' }) })
  chat.workflow.name = 'Mutated response'

  const stored = await request(`/api/workflows/${chat.workflow.id}`)
  assert.notEqual(stored.workflow.name, 'Mutated response')

  const fragment = await request('/api/fragments', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Prompt fragment',
      nodes: [stored.workflow.nodes[0]],
      edges: [],
      interface: { inputs: [], outputs: [] },
    }),
  })
  assert.equal((await request(`/api/fragments/${fragment.shareId}`)).id, fragment.id)
})

test('returns a running mock run before completing it', async () => {
  const storage = createMemoryStorage()
  const request = createLocalApi({ storage, origin: 'https://demo.test', wait: async () => {} })
  const [workflow] = await request('/api/workflows')
  const started = await request(`/api/workflows/${workflow.id}/runs`, { method: 'POST', body: '{}' })
  assert.equal(started.status, 'running')

  await new Promise((resolve) => setTimeout(resolve, 0))
  const completed = await request(`/api/workflows/${workflow.id}/runs/${started.id}`)
  assert.equal(completed.status, 'succeeded')
  assert.ok(Object.values(completed.nodeRuns).every((nodeRun) => nodeRun.status === 'succeeded'))
})
