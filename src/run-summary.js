export function summarizeRun(run, nodes) {
  if (!run) return null
  const nodeRuns = run.nodeRuns || {}
  const steps = nodes
    .filter((node) => nodeRuns[node.id])
    .map((node) => ({
      id: node.id,
      label: node.data.label,
      status: nodeRuns[node.id].status,
      durationMs: nodeRuns[node.id].durationMs,
      message: nodeRuns[node.id].error || nodeRuns[node.id].output?.message || '',
    }))
  const completed = steps.filter((step) => ['succeeded', 'failed'].includes(step.status)).length
  return {
    id: run.id,
    status: run.status,
    completed,
    total: steps.length,
    totalDurationMs: steps.reduce((total, step) => total + (step.durationMs || 0), 0),
    steps,
  }
}
