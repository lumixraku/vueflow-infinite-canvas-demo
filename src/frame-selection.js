export function removeFrameSelectionChanges(changes, nodes) {
  const frameIds = new Set(nodes.filter((node) => node.type === 'frame').map((node) => node.id))
  return changes.map((change) => frameIds.has(change.id) && change.type === 'select' && change.selected
    ? { ...change, selected: false }
    : change)
}
