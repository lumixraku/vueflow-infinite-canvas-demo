const terminalStatuses = new Set(['succeeded', 'failed'])

function nodeOutput(node) {
  if (node.type === 'generate-image') {
    return { message: 'Image candidates generated', previews: node.config?.previews || [] }
  }
  if (['generate-model', 'text-to-3d', 'retopology', 'texture', 'model-preview'].includes(node.type)) {
    return { message: `${node.name} generated`, preview: node.config?.preview || null }
  }
  return { message: `Mock ${node.type} result` }
}

export function executionNodes(workflow) {
  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]))
  const outgoing = new Map(workflow.nodes.map((node) => [node.id, []]))
  const indegree = new Map(workflow.nodes.map((node) => [node.id, 0]))

  for (const edge of workflow.edges || []) {
    const sourceId = edge.source?.nodeId
    const targetId = edge.target?.nodeId
    if (!nodesById.has(sourceId) || !nodesById.has(targetId)) continue
    outgoing.get(sourceId).push(targetId)
    indegree.set(targetId, indegree.get(targetId) + 1)
  }

  const queued = workflow.nodes.filter((node) => indegree.get(node.id) === 0)
  const ordered = []
  while (queued.length) {
    const node = queued.shift()
    ordered.push(node)
    for (const targetId of outgoing.get(node.id)) {
      indegree.set(targetId, indegree.get(targetId) - 1)
      if (indegree.get(targetId) === 0) queued.push(nodesById.get(targetId))
    }
  }

  return ordered.length === workflow.nodes.length ? ordered : workflow.nodes
}

export function createMockRun(workflow, { id = `run-${crypto.randomUUID()}`, now = () => new Date().toISOString() } = {}) {
  const createdAt = now()
  const nodes = executionNodes(workflow)
  const nodeRuns = Object.fromEntries(nodes.map((node, index) => [node.id, {
    status: index === 0 ? 'running' : 'queued',
    durationMs: null,
    output: null,
    error: null,
  }]))
  const empty = workflow.nodes.length === 0

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
    const durationMs = 650 + index * 240
    await wait(600)

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
