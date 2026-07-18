import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { planWorkflow } from './planner.js'
import { createStore } from './store.js'
import { createFragment, fragmentSummary } from './fragments.js'
import { createMockRun, downstreamWorkflow, executeMockRun } from './mock-runs.js'
import { latestNodeRuns } from './node-state.js'
import { createInitialConversation, createWorkflow } from './workflows.js'

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

function runById(workflowId, runId) {
  return state.runs.find((run) => run.id === runId && run.workflowId === workflowId)
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

    if (request.method === 'POST' && parts[1] === 'workflows' && parts.length === 2) {
      const workflow = createWorkflow(await body(request))
      const conversation = createInitialConversation(workflow)
      state.workflows.push(workflow)
      state.conversations.push(conversation)
      await Promise.all([persist('workflows'), persist('conversations')])
      return json(response, 201, workflow)
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
      return json(response, 200, { workflow, conversation: conversationFor(workflow.id), nodeRuns: latestNodeRuns(workflow, state.runs) })
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

    if (request.method === 'GET' && parts[1] === 'workflows' && parts[3] === 'runs' && parts.length === 5) {
      const workflow = workflowById(parts[2])
      if (!workflow) return json(response, 404, { error: 'Workflow not found' })
      const run = runById(workflow.id, parts[4])
      if (!run) return json(response, 404, { error: 'Run not found' })
      return json(response, 200, run)
    }

    if (request.method === 'POST' && parts[1] === 'workflows' && parts[3] === 'runs' && parts.length === 4) {
      const workflow = workflowById(parts[2])
      if (!workflow) return json(response, 404, { error: 'Workflow not found' })
      const { targetNodeId, scope = 'node' } = await body(request)
      const targetNode = targetNodeId ? workflow.nodes.find((node) => node.id === targetNodeId) : null
      if (targetNodeId && !targetNode) return json(response, 400, { error: 'Target node not found' })
      if (!['node', 'downstream'].includes(scope)) return json(response, 400, { error: 'Invalid run scope' })
      if (scope === 'downstream' && !targetNode) return json(response, 400, { error: 'A target node is required for downstream runs' })

      let executionWorkflow = structuredClone(workflow)
      if (scope === 'downstream') executionWorkflow = downstreamWorkflow(workflow, targetNodeId)
      else if (targetNode) {
        executionWorkflow.nodes = [structuredClone(targetNode)]
        executionWorkflow.edges = []
      }
      const run = createMockRun(executionWorkflow)
      state.runs.push(run)
      await persist('runs')
      void executeMockRun(run, executionWorkflow, { persist: () => persist('runs') }).catch(async (error) => {
        run.status = 'failed'
        run.completedAt = new Date().toISOString()
        run.error = error.message
        try {
          await persist('runs')
        } catch (persistError) {
          console.error(persistError)
        }
      })
      return json(response, 201, run)
    }

    return json(response, 404, { error: 'Not found' })
  } catch (error) {
    if (!error.statusCode) console.error(error)
    return json(response, error.statusCode || 500, { error: error.message })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Mock API listening on http://127.0.0.1:${port}`)
})

export { server }

if (process.argv[1] !== fileURLToPath(import.meta.url)) server.close()
