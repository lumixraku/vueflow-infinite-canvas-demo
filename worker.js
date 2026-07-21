import { createFragment, fragmentSummary } from './server/fragments.js'
import { createMockRun, downstreamWorkflow, executeMockRun } from './server/mock-runs.js'
import { latestNodeRuns } from './server/node-state.js'
import { createInitialConversation, createWorkflow } from './server/workflows.js'
import { runDeepSeekAgent } from './server/deepseek.js'

const collections = ['workflows', 'conversations', 'runs', 'fragments', 'tasks']
const terminalStatuses = new Set(['succeeded', 'failed'])

function id() {
  return crypto.randomUUID()
}

function clone(value) {
  return structuredClone(value)
}

async function readCollection(env, collection) {
  const value = await env.DB.prepare('SELECT value FROM app_state WHERE collection = ?1').bind(collection).first('value')
  return value ? JSON.parse(value) : []
}

async function writeCollections(env, state, names = collections) {
  const statements = names.map((name) => env.DB.prepare('INSERT INTO app_state (collection, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(collection) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(name, JSON.stringify(state[name]), new Date().toISOString()))
  await env.DB.batch(statements)
}

async function loadState(env) {
  const values = await Promise.all(collections.map((name) => readCollection(env, name)))
  return Object.fromEntries(collections.map((name, index) => [name, values[index]]))
}

function response(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function workflowById(state, workflowId) {
  return state.workflows.find((workflow) => workflow.id === workflowId)
}

function conversationFor(state, workflowId) {
  return state.conversations.find((conversation) => conversation.workflowId === workflowId)
}

function taskById(state, taskId) {
  return state.tasks.find((task) => task.id === taskId)
}

async function executeAgentTask(env, state, task) {
  task.status = 'running'
  task.startedAt = new Date().toISOString()
  await writeCollections(env, state, ['tasks'])
  try {
    const workflow = workflowById(state, task.workflowId)
    if (!workflow) throw new Error('Workflow not found')
    const conversation = conversationFor(state, task.workflowId)
    const plan = await runDeepSeekAgent({
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL,
      model: env.DEEPSEEK_MODEL,
      message: task.message,
      workflow,
      history: conversation?.messages || [],
      onProgress: async (event) => {
        task.progress.push(event)
        task.updatedAt = new Date().toISOString()
        await writeCollections(env, state, ['tasks'])
      },
    })
    const index = state.workflows.findIndex((item) => item.id === plan.workflow.id)
    if (index < 0) state.workflows.push(plan.workflow)
    else state.workflows[index] = plan.workflow
    let nextConversation = conversationFor(state, plan.workflow.id)
    if (!nextConversation) {
      nextConversation = { id: `conv-${id()}`, workflowId: plan.workflow.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] }
      state.conversations.push(nextConversation)
    }
    const now = new Date().toISOString()
    nextConversation.messages.push(
      { id: `msg-${id()}`, role: 'user', content: task.message, createdAt: now },
      { id: `msg-${id()}`, role: 'assistant', content: plan.reply, progress: task.progress, createdAt: now },
    )
    nextConversation.updatedAt = now
    task.status = 'succeeded'
    task.result = clone({ ...plan, conversation: nextConversation })
    task.completedAt = new Date().toISOString()
    task.updatedAt = task.completedAt
    await writeCollections(env, state, ['workflows', 'conversations', 'tasks'])
  } catch (error) {
    task.status = 'failed'
    task.error = error.message
    task.completedAt = new Date().toISOString()
    task.updatedAt = task.completedAt
    await writeCollections(env, state, ['tasks'])
  }
}

async function parseJson(request) {
  return request.json().catch(() => ({}))
}

async function route(request, env, ctx) {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'api') return env.ASSETS.fetch(request)
  const state = await loadState(env)

  if (request.method === 'GET' && parts[1] === 'workflows' && parts.length === 2) {
    return response(state.workflows.map(({ nodes, edges, ...workflow }) => ({ ...workflow, nodeCount: nodes.length, edgeCount: edges.length })))
  }
  if (request.method === 'GET' && parts[1] === 'workflows' && parts.length === 3) {
    const workflow = workflowById(state, parts[2])
    return workflow ? response({ workflow, conversation: conversationFor(state, workflow.id), nodeRuns: latestNodeRuns(workflow, state.runs) }) : response({ error: 'Workflow not found' }, 404)
  }
  if (request.method === 'POST' && parts[1] === 'workflows' && parts.length === 2) {
    const workflow = createWorkflow(await parseJson(request))
    state.workflows.push(workflow)
    state.conversations.push(createInitialConversation(workflow))
    await writeCollections(env, state, ['workflows', 'conversations'])
    return response(workflow, 201)
  }
  if (request.method === 'PUT' && parts[1] === 'workflows' && parts.length === 3) {
    const index = state.workflows.findIndex((workflow) => workflow.id === parts[2])
    if (index < 0) return response({ error: 'Workflow not found' }, 404)
    state.workflows[index] = { ...(await parseJson(request)), id: parts[2], updatedAt: new Date().toISOString() }
    await writeCollections(env, state, ['workflows'])
    return response(state.workflows[index])
  }
  if (request.method === 'DELETE' && parts[1] === 'workflows' && parts.length === 3) {
    const index = state.workflows.findIndex((workflow) => workflow.id === parts[2])
    if (index < 0) return response({ error: 'Workflow not found' }, 404)
    state.workflows.splice(index, 1)
    state.conversations = state.conversations.filter((conversation) => conversation.workflowId !== parts[2])
    state.runs = state.runs.filter((run) => run.workflowId !== parts[2])
    state.tasks = state.tasks.filter((task) => task.workflowId !== parts[2] || terminalStatuses.has(task.status))
    await writeCollections(env, state, ['workflows', 'conversations', 'runs', 'tasks'])
    return response(null, 204)
  }
  if (request.method === 'POST' && parts[1] === 'workflows' && parts[3] === 'duplicate') {
    const source = workflowById(state, parts[2])
    if (!source) return response({ error: 'Workflow not found' }, 404)
    const now = new Date().toISOString()
    const workflow = { ...clone(source), id: `wf-${id()}`, name: `${source.name} Copy`, revision: 1, createdAt: now, updatedAt: now }
    state.workflows.push(workflow)
    state.conversations.push({ id: `conv-${id()}`, workflowId: workflow.id, createdAt: now, updatedAt: now, messages: [{ id: `msg-${id()}`, role: 'assistant', content: 'This workflow was duplicated and can now evolve independently.', createdAt: now }] })
    await writeCollections(env, state, ['workflows', 'conversations'])
    return response(workflow, 201)
  }
  if (request.method === 'GET' && parts[1] === 'fragments' && parts.length === 2) return response(state.fragments.map(fragmentSummary))
  if (request.method === 'GET' && parts[1] === 'fragments' && parts.length === 3) {
    const fragment = state.fragments.find((item) => item.id === parts[2] || item.shareId === parts[2])
    return fragment ? response(fragment) : response({ error: 'Fragment not found' }, 404)
  }
  if (request.method === 'POST' && parts[1] === 'fragments' && parts.length === 2) {
    const fragment = createFragment(await parseJson(request))
    state.fragments.push(fragment)
    await writeCollections(env, state, ['fragments'])
    return response(fragment, 201)
  }
  if (request.method === 'DELETE' && parts[1] === 'fragments' && parts.length === 3) {
    const index = state.fragments.findIndex((item) => item.id === parts[2])
    if (index < 0) return response({ error: 'Fragment not found' }, 404)
    state.fragments.splice(index, 1)
    await writeCollections(env, state, ['fragments'])
    return response(null, 204)
  }
  if (request.method === 'GET' && parts[1] === 'tasks' && parts.length === 3) {
    const task = taskById(state, parts[2])
    return task ? response(task) : response({ error: 'Task not found' }, 404)
  }
  if (request.method === 'GET' && parts[1] === 'tasks' && parts.length === 2) {
    const statuses = new Set((url.searchParams.get('status') || '').split(',').filter(Boolean))
    return response(state.tasks.filter((task) => (!url.searchParams.get('workflowId') || task.workflowId === url.searchParams.get('workflowId')) && (!statuses.size || statuses.has(task.status))))
  }
  if (request.method === 'POST' && parts[1] === 'chat' && parts.length === 2) {
    const input = await parseJson(request)
    if (typeof input.message !== 'string' || !input.message.trim()) return response({ error: 'message is required' }, 400)
    if (!env.DEEPSEEK_API_KEY) return response({ error: 'DeepSeek is not configured.' }, 503)
    const workflow = input.workflowId ? workflowById(state, input.workflowId) : createWorkflow({ name: 'New workflow', nodes: [], edges: [] })
    if (!workflow) return response({ error: 'Workflow not found' }, 404)
    if (!input.workflowId) {
      state.workflows.push(workflow)
      state.conversations.push(createInitialConversation(workflow))
    }
    const now = new Date().toISOString()
    const task = { id: `task-${id()}`, workflowId: workflow.id, message: input.message, status: 'queued', progress: [], createdAt: now, updatedAt: now }
    state.tasks.push(task)
    await writeCollections(env, state, ['workflows', 'conversations', 'tasks'])
    ctx.waitUntil(executeAgentTask(env, state, task))
    return response(task, 202)
  }
  if (request.method === 'GET' && parts[1] === 'workflows' && parts[3] === 'runs' && parts.length === 5) {
    const run = state.runs.find((item) => item.id === parts[4] && item.workflowId === parts[2])
    return run ? response(run) : response({ error: 'Run not found' }, 404)
  }
  if (request.method === 'POST' && parts[1] === 'workflows' && parts[3] === 'runs' && parts.length === 4) {
    const workflow = workflowById(state, parts[2])
    if (!workflow) return response({ error: 'Workflow not found' }, 404)
    const input = await parseJson(request)
    const { targetNodeId, scope = 'node' } = input
    const targetNode = targetNodeId ? workflow.nodes.find((node) => node.id === targetNodeId) : null
    if (targetNodeId && !targetNode) return response({ error: 'Target node not found' }, 400)
    if (!['node', 'downstream'].includes(scope)) return response({ error: 'Invalid run scope' }, 400)
    if (scope === 'downstream' && !targetNode) return response({ error: 'A target node is required for downstream runs' }, 400)
    let executionWorkflow = clone(workflow)
    if (scope === 'downstream') executionWorkflow = downstreamWorkflow(workflow, targetNodeId)
    else if (targetNode) {
      executionWorkflow.nodes = [clone(targetNode)]
      executionWorkflow.edges = []
    }
    const run = createMockRun(executionWorkflow)
    state.runs.push(run)
    await writeCollections(env, state, ['runs'])
    ctx.waitUntil(executeMockRun(run, executionWorkflow, { persist: () => writeCollections(env, state, ['runs']) }))
    return response(run, 201)
  }
  return response({ error: 'Not found' }, 404)
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx)
    } catch (error) {
      return response({ error: error.message }, error.statusCode || 500)
    }
  },
}
