import workflowSeed from '../server/seed/workflows.json' with { type: 'json' }
import conversationSeed from '../server/seed/conversations.json' with { type: 'json' }
import runSeed from '../server/seed/runs.json' with { type: 'json' }
import fragmentSeed from '../server/seed/fragments.json' with { type: 'json' }
import { createFragment, fragmentSummary } from '../server/fragments.js'
import { createMockRun, executeMockRun } from '../server/mock-runs.js'
import { latestNodeRuns } from '../server/node-state.js'
import { planWorkflow } from '../server/planner.js'

const storageKey = 'forge3d-demo-state-v1'

function initialState() {
  return structuredClone({
    workflows: workflowSeed,
    conversations: conversationSeed,
    runs: runSeed,
    fragments: fragmentSeed,
  })
}

function loadState(storage) {
  const saved = storage.getItem(storageKey)
  if (!saved) {
    const state = initialState()
    storage.setItem(storageKey, JSON.stringify(state))
    return state
  }

  try {
    const state = JSON.parse(saved)
    if (!['workflows', 'conversations', 'runs', 'fragments'].every((key) => Array.isArray(state[key]))) throw new Error()
    return state
  } catch {
    const state = initialState()
    storage.setItem(storageKey, JSON.stringify(state))
    return state
  }
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

export function createLocalApi({ storage = localStorage, wait, origin = location.origin } = {}) {
  const state = loadState(storage)
  const persist = () => storage.setItem(storageKey, JSON.stringify(state))
  const workflowById = (id) => state.workflows.find((workflow) => workflow.id === id)
  const conversationFor = (workflowId) => state.conversations.find((conversation) => conversation.workflowId === workflowId)

  return async function request(url, options = {}) {
    const method = options.method || 'GET'
    const parts = new URL(url, origin).pathname.split('/').filter(Boolean)
    const input = options.body ? JSON.parse(options.body) : {}

    if (method === 'GET' && parts[1] === 'workflows' && parts.length === 2) {
      return clone(state.workflows.map(({ nodes, edges, ...workflow }) => ({ ...workflow, nodeCount: nodes.length, edgeCount: edges.length })))
    }

    if (method === 'GET' && parts[1] === 'fragments' && parts.length === 2) {
      return clone(state.fragments.map(fragmentSummary))
    }

    if (method === 'GET' && parts[1] === 'fragments' && parts.length === 3) {
      const fragment = state.fragments.find((item) => item.id === parts[2] || item.shareId === parts[2])
      if (!fragment) throw new Error('Fragment not found')
      return clone(fragment)
    }

    if (method === 'POST' && parts[1] === 'fragments' && parts.length === 2) {
      const fragment = createFragment(input)
      state.fragments.push(fragment)
      persist()
      return clone(fragment)
    }

    if (method === 'DELETE' && parts[1] === 'fragments' && parts.length === 3) {
      const index = state.fragments.findIndex((fragment) => fragment.id === parts[2])
      if (index < 0) throw new Error('Fragment not found')
      state.fragments.splice(index, 1)
      persist()
      return null
    }

    if (method === 'GET' && parts[1] === 'workflows' && parts.length === 3) {
      const workflow = workflowById(parts[2])
      if (!workflow) throw new Error('Workflow not found')
      return clone({ workflow, conversation: conversationFor(workflow.id), nodeRuns: latestNodeRuns(workflow, state.runs) })
    }

    if (method === 'PUT' && parts[1] === 'workflows' && parts.length === 3) {
      const index = state.workflows.findIndex((workflow) => workflow.id === parts[2])
      if (index < 0) throw new Error('Workflow not found')
      state.workflows[index] = { ...clone(input), id: parts[2], updatedAt: new Date().toISOString() }
      persist()
      return clone(state.workflows[index])
    }

    if (method === 'POST' && parts[1] === 'chat' && parts.length === 2) {
      const existing = input.workflowId ? workflowById(input.workflowId) : null
      const plan = planWorkflow(input.message || '', existing)
      const workflowIndex = state.workflows.findIndex((workflow) => workflow.id === plan.workflow.id)
      if (workflowIndex < 0) state.workflows.push(plan.workflow)
      else state.workflows[workflowIndex] = plan.workflow

      let conversation = conversationFor(plan.workflow.id)
      if (!conversation) {
        const createdAt = new Date().toISOString()
        conversation = { id: `conv-${crypto.randomUUID()}`, workflowId: plan.workflow.id, createdAt, updatedAt: createdAt, messages: [] }
        state.conversations.push(conversation)
      }
      const now = new Date().toISOString()
      conversation.messages.push(
        { id: `msg-${crypto.randomUUID()}`, role: 'user', content: input.message, createdAt: now },
        { id: `msg-${crypto.randomUUID()}`, role: 'assistant', content: plan.reply, createdAt: now },
      )
      conversation.updatedAt = now
      persist()
      return clone({ ...plan, conversation })
    }

    if (method === 'POST' && parts[1] === 'workflows' && parts[3] === 'duplicate' && parts.length === 4) {
      const source = workflowById(parts[2])
      if (!source) throw new Error('Workflow not found')
      const now = new Date().toISOString()
      const workflow = { ...clone(source), id: `wf-${crypto.randomUUID()}`, name: `${source.name} Copy`, revision: 1, createdAt: now, updatedAt: now }
      state.workflows.push(workflow)
      state.conversations.push({ id: `conv-${crypto.randomUUID()}`, workflowId: workflow.id, createdAt: now, updatedAt: now, messages: [{ id: `msg-${crypto.randomUUID()}`, role: 'assistant', content: 'This workflow was duplicated and can now evolve independently.', createdAt: now }] })
      persist()
      return clone(workflow)
    }

    if (method === 'GET' && parts[1] === 'workflows' && parts[3] === 'runs' && parts.length === 5) {
      const workflow = workflowById(parts[2])
      if (!workflow) throw new Error('Workflow not found')
      const run = state.runs.find((item) => item.id === parts[4] && item.workflowId === workflow.id)
      if (!run) throw new Error('Run not found')
      return clone(run)
    }

    if (method === 'POST' && parts[1] === 'workflows' && parts[3] === 'runs' && parts.length === 4) {
      const workflow = workflowById(parts[2])
      if (!workflow) throw new Error('Workflow not found')
      const targetNode = input.targetNodeId ? workflow.nodes.find((node) => node.id === input.targetNodeId) : null
      if (input.targetNodeId && !targetNode) throw new Error('Target node not found')
      const executionWorkflow = clone(workflow)
      if (targetNode) executionWorkflow.nodes = [clone(targetNode)]
      const run = createMockRun(executionWorkflow)
      state.runs.push(run)
      persist()
      void executeMockRun(run, executionWorkflow, { wait, persist: async () => persist() }).catch((error) => {
        run.status = 'failed'
        run.completedAt = new Date().toISOString()
        run.error = error.message
        persist()
      })
      return clone(run)
    }

    throw new Error('Not found')
  }
}

let browserRequest

export function localRequest(...args) {
  browserRequest ||= createLocalApi()
  return browserRequest(...args)
}
