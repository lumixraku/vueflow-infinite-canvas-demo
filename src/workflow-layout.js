const DEFAULT_WIDTH = 290
const DEFAULT_HEIGHT = 430
let elkPromise

function getElk() {
  elkPromise ||= import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => new ELK())
  return elkPromise
}

function sizeOf(node) {
  return {
    width: node.dimensions?.width || node.width || DEFAULT_WIDTH,
    height: node.dimensions?.height || node.height || DEFAULT_HEIGHT,
  }
}

export async function layoutWorkflow(nodes, edges, { originX = 0, originY = 120, columnGap = 100, rowGap = 80 } = {}) {
  if (!nodes.length) return new Map()

  const nodeIds = new Set(nodes.map((node) => node.id))
  const graph = {
    id: 'workflow',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'SPLINES',
      'elk.spacing.nodeNode': String(rowGap),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(columnGap),
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': String(rowGap * 1.5),
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
    },
    children: nodes.map((node) => ({ id: node.id, ...sizeOf(node) })),
    edges: edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source !== edge.target)
      .map((edge, index) => ({ id: edge.id || `layout-edge-${index}-${edge.source}-${edge.target}`, sources: [edge.source], targets: [edge.target] })),
  }

  const elk = await getElk()
  const result = await elk.layout(graph)
  return new Map(result.children.map((node) => [node.id, { x: originX + node.x, y: originY + node.y }]))
}
