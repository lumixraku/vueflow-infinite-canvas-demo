import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { planWorkflow } from './planner.js'
import { createStore } from './store.js'
import { createFragment, fragmentSummary } from './fragments.js'

const port = Number(process.env.PORT || 8787)
const { state, persist } = await createStore()

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

async function body(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

function route(request) {
  return new URL(request.url, `http://${request.headers.host}`).pathname.split('/').filter(Boolean)
}

function workflowById(id) {
  return state.workflows.find((workflow) => workflow.id === id)
}

function conversationFor(workflowId) {
  return state.conversations.find((conversation) => conversation.workflowId === workflowId)
}

function fragmentById(id) {
  return state.fragments.find((fragment) => fragment.id === id || fragment.shareId === id)
}

const server = createServer(async (request, response) => {
  try {
    const parts = route(request)
    if (parts[0] !== 'api') return json(response, 404, { error: 'Not found' })

    if (request.method === 'GET' && parts[1] === 'workflows' && parts.length === 2) {
      return json(response, 200, state.workflows.map(({ nodes, edges, ...workflow }) => ({ ...workflow, nodeCount: nodes.length, edgeCount: edges.length })))
    }

    if (request.method === 'GET' && parts[1] === 'fragments' && parts.length === 2) {
      return json(response, 200, state.fragments.map(fragmentSummary))
    }

    if (request.method === 'GET' && parts[1] === 'fragments' && parts.length === 3) {
      const fragment = fragmentById(parts[2])
      if (!fragment) return json(response, 404, { error: 'Fragment not found' })
      return json(response, 200, fragment)
    }

    if (request.method === 'POST' && parts[1] === 'fragments' && parts.length === 2) {
      const fragment = createFragment(await body(request))
      state.fragments.push(fragment)
      await persist('fragments')
      return json(response, 201, fragment)
    }

    if (request.method === 'DELETE' && parts[1] === 'fragments' && parts.length === 3) {
      const index = state.fragments.findIndex((fragment) => fragment.id === parts[2])
      if (index < 0) return json(response, 404, { error: 'Fragment not found' })
      state.fragments.splice(index, 1)
      await persist('fragments')
      return json(response, 204, null)
    }

    if (request.method === 'GET' && parts[1] === 'workflows' && parts.length === 3) {
      const workflow = workflowById(parts[2])
      if (!workflow) return json(response, 404, { error: 'Workflow not found' })
      return json(response, 200, { workflow, conversation: conversationFor(workflow.id) })
    }

    if (request.method === 'PUT' && parts[1] === 'workflows' && parts.length === 3) {
      const index = state.workflows.findIndex((workflow) => workflow.id === parts[2])
      if (index < 0) return json(response, 404, { error: 'Workflow not found' })
      const input = await body(request)
      state.workflows[index] = { ...input, id: parts[2], updatedAt: new Date().toISOString() }
      await persist('workflows')
      return json(response, 200, state.workflows[index])
    }

    if (request.method === 'POST' && parts[1] === 'chat') {
      const input = await body(request)
      const existing = input.workflowId ? workflowById(input.workflowId) : null
      const plan = planWorkflow(input.message || '', existing)
      const workflowIndex = state.workflows.findIndex((workflow) => workflow.id === plan.workflow.id)
      if (workflowIndex < 0) state.workflows.push(plan.workflow)
      else state.workflows[workflowIndex] = plan.workflow

      let conversation = conversationFor(plan.workflow.id)
      if (!conversation) {
        conversation = { id: `conv-${randomUUID()}`, workflowId: plan.workflow.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] }
        state.conversations.push(conversation)
      }
      const now = new Date().toISOString()
      conversation.messages.push(
        { id: `msg-${randomUUID()}`, role: 'user', content: input.message, createdAt: now },
        { id: `msg-${randomUUID()}`, role: 'assistant', content: plan.reply, createdAt: now },
      )
      conversation.updatedAt = now
      await Promise.all([persist('workflows'), persist('conversations')])
      return json(response, 200, { ...plan, conversation })
    }

    if (request.method === 'POST' && parts[1] === 'workflows' && parts[3] === 'duplicate') {
      const source = workflowById(parts[2])
      if (!source) return json(response, 404, { error: 'Workflow not found' })
      const now = new Date().toISOString()
      const workflow = { ...structuredClone(source), id: `wf-${randomUUID()}`, name: `${source.name} Copy`, revision: 1, createdAt: now, updatedAt: now }
      state.workflows.push(workflow)
      state.conversations.push({ id: `conv-${randomUUID()}`, workflowId: workflow.id, createdAt: now, updatedAt: now, messages: [{ id: `msg-${randomUUID()}`, role: 'assistant', content: 'This workflow was duplicated and can now evolve independently.', createdAt: now }] })
      await Promise.all([persist('workflows'), persist('conversations')])
      return json(response, 201, workflow)
    }

    if (request.method === 'POST' && parts[1] === 'workflows' && parts[3] === 'runs') {
      const workflow = workflowById(parts[2])
      if (!workflow) return json(response, 404, { error: 'Workflow not found' })
      const now = new Date().toISOString()
      const run = {
        id: `run-${randomUUID()}`,
        workflowId: workflow.id,
        workflowRevision: workflow.revision,
        status: 'succeeded',
        createdAt: now,
        completedAt: now,
        nodeRuns: Object.fromEntries(workflow.nodes.map((node, index) => [node.id, { status: 'succeeded', durationMs: 650 + index * 240, output: `Mock ${node.type} result` }])),
      }
      state.runs.push(run)
      await persist('runs')
      return json(response, 201, run)
    }

    return json(response, 404, { error: 'Not found' })
  } catch (error) {
    console.error(error)
    return json(response, 500, { error: error.message })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Mock API listening on http://127.0.0.1:${port}`)
})

export { server }

if (process.argv[1] !== fileURLToPath(import.meta.url)) server.close()
