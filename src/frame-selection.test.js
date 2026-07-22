import test from 'node:test'
import assert from 'node:assert/strict'
import { removeFrameSelectionChanges } from './frame-selection.js'

test('removes frame selection without changing selected child nodes', () => {
  const changes = [
    { id: 'frame-1', type: 'select', selected: true },
    { id: 'child-1', type: 'select', selected: true },
    { id: 'outside', type: 'select', selected: false },
  ]

  assert.deepEqual(removeFrameSelectionChanges(changes, [
    { id: 'frame-1', type: 'frame' },
    { id: 'child-1', type: 'workflow', parentNode: 'frame-1' },
  ]), [
    { id: 'frame-1', type: 'select', selected: false },
    { id: 'child-1', type: 'select', selected: true },
    { id: 'outside', type: 'select', selected: false },
  ])
})

test('does not alter frame deselection or non-selection changes', () => {
  const changes = [
    { id: 'frame-1', type: 'select', selected: false },
    { id: 'frame-1', type: 'position', position: { x: 10, y: 20 } },
  ]

  assert.deepEqual(removeFrameSelectionChanges(changes, [{ id: 'frame-1', type: 'frame' }]), changes)
})
