import { randomUUID } from './ids.js'

const terminalStatuses = new Set(['succeeded', 'failed', 'waiting_review'])

function nodeOutput(node) {
  if (node.type === 'generate-image') {
    return { message: 'Image candidates generated', previews: node.config?.previews || [] }
  }
  if (node.type === 'generate-multiview-images') {
    return { message: 'Front, back, left, and right views generated', viewPreviews: node.config?.viewPreviews || {} }
  }
  if (node.type === 'review') {
    return { message: 'Awaiting image approval', preview: node.config?.preview || null }
  }
  if (['generate-model', 'multiview-to-3d', 'text-to-3d', 'retopology', 'texture', 'model-preview'].includes(node.type)) {
    return { message: `${node.name} generated`, preview: node.config?.preview || null }
  }
  return { message: `Mock ${node.type} result` }
}

export function executionNodes(workflow) {
  const executableNodes = workflow.nodes.filter((node) => node.type !== 'frame')
  const nodesById = new Map(executableNodes.map((node) => [node.id, node]))
  const outgoing = new Map(executableNodes.map((node) => [node.id, []]))
  const indegree = new Map(executableNodes.map((node) => [node.id, 0]))

  const dependencies = new Set()
  for (const edge of workflow.edges || []) {
    const sourceId = edge.source?.nodeId
    const targetId = edge.target?.nodeId
    if (!nodesById.has(sourceId) || !nodesById.has(targetId) || dependencies.has(`${sourceId}:${targetId}`)) continue
    dependencies.add(`${sourceId}:${targetId}`)
    outgoing.get(sourceId).push(targetId)
    indegree.set(targetId, indegree.get(targetId) + 1)
  }

  const queued = executableNodes.filter((node) => indegree.get(node.id) === 0)
  const ordered = []
  while (queued.length) {
    const node = queued.shift()
    ordered.push(node)
    for (const targetId of outgoing.get(node.id)) {
      indegree.set(targetId, indegree.get(targetId) - 1)
      if (indegree.get(targetId) === 0) queued.push(nodesById.get(targetId))
    }
  }

  return ordered.length === executableNodes.length ? ordered : executableNodes
}

export function downstreamWorkflow(workflow, startNodeId) {
  const executableNodes = workflow.nodes.filter((node) => node.type !== 'frame')
  const nodeIds = new Set(executableNodes.map((node) => node.id))
  if (!nodeIds.has(startNodeId)) return null

  const outgoing = new Map(executableNodes.map((node) => [node.id, []]))
  for (const edge of workflow.edges || []) {
    const sourceId = edge.source?.nodeId
    const targetId = edge.target?.nodeId
    if (outgoing.has(sourceId) && nodeIds.has(targetId)) outgoing.get(sourceId).push(targetId)
  }

  const includedNodeIds = new Set([startNodeId])
  const queued = [startNodeId]
  while (queued.length) {
    const nodeId = queued.shift()
    for (const targetId of outgoing.get(nodeId)) {
      if (includedNodeIds.has(targetId)) continue
      includedNodeIds.add(targetId)
      queued.push(targetId)
    }
  }

  return {
    ...structuredClone(workflow),
    nodes: executableNodes.filter((node) => includedNodeIds.has(node.id)).map((node) => structuredClone(node)),
    edges: (workflow.edges || []).filter((edge) => (
      includedNodeIds.has(edge.source?.nodeId) && includedNodeIds.has(edge.target?.nodeId)
    )).map((edge) => structuredClone(edge)),
  }
}

export function createMockRun(workflow, { id = `run-${randomUUID()}`, now = () => new Date().toISOString() } = {}) {
  const createdAt = now()
  const nodes = executionNodes(workflow)
  const nodeRuns = Object.fromEntries(nodes.map((node, index) => [node.id, {
    status: index === 0 ? 'running' : 'queued',
    durationMs: null,
    output: null,
    error: null,
  }]))
  const empty = nodes.length === 0

  return {
    id,
    workflowId: workflow.id,
    workflowRevision: workflow.revision,
    status: empty ? 'succeeded' : 'running',
    createdAt,
    completedAt: empty ? createdAt : null,
    nodeRuns,
  }
}

export async function executeMockRun(run, workflow, {
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  persist = async () => {},
  now = () => new Date().toISOString(),
} = {}) {
  const nodes = executionNodes(workflow)
  for (const [index, node] of nodes.entries()) {
    const nodeRun = run.nodeRuns[node.id]
    nodeRun.status = 'running'
    await persist()
    const durationMs = 650
    await wait(600)

    if (node.type === 'review' && !node.config?.approved) {
      nodeRun.status = 'waiting_review'
      nodeRun.durationMs = durationMs
      nodeRun.output = nodeOutput(node)
      run.status = 'waiting_review'
      await persist()
      return run
    }

    if (node.config?.mockFailure) {
      nodeRun.status = 'failed'
      nodeRun.durationMs = durationMs
      nodeRun.error = `Mock ${node.type} execution failed`
      run.status = 'failed'
      run.completedAt = now()
      await persist()
      return run
    }

    nodeRun.status = 'succeeded'
    nodeRun.durationMs = durationMs
    nodeRun.output = nodeOutput(node)
    if (nodes[index + 1]) run.nodeRuns[nodes[index + 1].id].status = 'running'
    await persist()
  }

  run.status = 'succeeded'
  run.completedAt = now()
  await persist()
  return run
}

export function isRunTerminal(run) {
  return terminalStatuses.has(run.status)
}
