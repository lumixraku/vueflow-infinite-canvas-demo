import test from 'node:test'
import assert from 'node:assert/strict'
import { planWorkflow } from './planner.js'

test('creates a reusable workflow', () => {
  const { workflow } = planWorkflow('Create a game character workflow')
  assert.equal(workflow.schemaVersion, '1.0')
  assert.equal(workflow.nodes.length, 6)
  assert.equal(workflow.edges.length, 5)
})

test('adds requested stages without duplicates', () => {
  const initial = planWorkflow('Create a prop workflow').workflow
  const first = planWorkflow('Add low-poly and PBR texture, export FBX', initial).workflow
  const second = planWorkflow('Add low-poly again', first).workflow
  assert.equal(first.nodes.filter((node) => node.type === 'retopology').length, 1)
  assert.equal(first.nodes.filter((node) => node.type === 'texture').length, 1)
  assert.equal(second.nodes.filter((node) => node.type === 'retopology').length, 1)
  assert.equal(first.nodes.find((node) => node.type === 'export-model').config.format, 'fbx')
  assert.ok(new Set(first.nodes.map((node) => node.ui.position.y)).size > 1)
})
