import test from 'node:test'
import assert from 'node:assert/strict'
import { runDeepSeekAgent } from './deepseek.js'
import { planWorkflow } from './planner.js'

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

test('uses DeepSeek tool calls to update validated node parameters', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow').workflow
  const requests = []
  const replies = [
    response({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'update_node_parameters', arguments: JSON.stringify({ nodeId: 'text-to-3d', parameters: { faceCount: 12000, modelVersion: 'v2.5' } }) } }] } }] }),
    response({ choices: [{ message: { role: 'assistant', content: 'Updated Text to 3D to 12,000 faces using v2.5.' } }] }),
  ]
  const fetchImpl = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) })
    return replies.shift()
  }

  const result = await runDeepSeekAgent({ apiKey: 'test-key', message: 'Use 12,000 faces and v2.5', workflow, fetchImpl })

  assert.equal(result.workflow.nodes.find((node) => node.id === 'text-to-3d').config.faceCount, 12000)
  assert.equal(result.workflow.nodes.find((node) => node.id === 'text-to-3d').config.modelVersion, 'v2.5')
  assert.deepEqual(result.changedNodeIds, ['text-to-3d'])
  assert.equal(requests.length, 2)
  assert.equal(requests[0].options.headers.authorization, 'Bearer test-key')
  assert.equal(requests[0].body.model, 'deepseek-v4-flash')
  assert.equal(requests[1].body.messages.at(-1).tool_call_id, 'call-1')
})

test('accepts user-facing parameter labels returned by DeepSeek', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow').workflow
  const replies = [
    response({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'update_node_parameters', arguments: JSON.stringify({ nodeId: 'text-to-3d', parameters: { 'generated face count': 12000, 'model version': 'v2.5' } }) } }] } }] }),
    response({ choices: [{ message: { role: 'assistant', content: 'Updated.' } }] }),
  ]

  const result = await runDeepSeekAgent({ apiKey: 'test-key', message: 'Update it', workflow, fetchImpl: async () => replies.shift() })

  assert.equal(result.workflow.nodes.find((node) => node.id === 'text-to-3d').config.faceCount, 12000)
  assert.equal(result.workflow.nodes.find((node) => node.id === 'text-to-3d').config.modelVersion, 'v2.5')
})

test('describes every adjustable field in the update tool schema', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow with retopology and texture').workflow
  let requestBody

  await runDeepSeekAgent({
    apiKey: 'test-key',
    message: 'Update retopology and texture',
    workflow,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return response({ choices: [{ message: { role: 'assistant', content: 'No changes.' } }] })
    },
  })

  const updateTool = requestBody.tools.find((tool) => tool.function.name === 'update_node_parameters')
  const properties = updateTool.function.parameters.properties.parameters.properties
  assert.deepEqual(properties.faceType.enum, ['Triangle', 'Quad'])
  assert.equal(properties.faceLimit.multipleOf, 500)
  assert.deepEqual(properties.resolution.enum, ['1K', '2K', '4K'])
})

test('applies multiple parameters across multiple tool calls', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow with retopology and texture').workflow
  const replies = [
    response({ choices: [{ message: { role: 'assistant', tool_calls: [
      { id: 'call-1', type: 'function', function: { name: 'update_node_parameters', arguments: JSON.stringify({ nodeId: 'retopology', parameters: { faceLimit: 6000, faceType: 'Quad' } }) } },
      { id: 'call-2', type: 'function', function: { name: 'update_node_parameters', arguments: JSON.stringify({ nodeId: 'texture', parameters: { resolution: '4K' } }) } },
    ] } }] }),
    response({ choices: [{ message: { role: 'assistant', content: 'Updated.' } }] }),
  ]

  const result = await runDeepSeekAgent({ apiKey: 'test-key', message: 'Update it', workflow, fetchImpl: async () => replies.shift() })

  assert.equal(result.workflow.nodes.find((node) => node.id === 'retopology').config.faceLimit, 6000)
  assert.equal(result.workflow.nodes.find((node) => node.id === 'retopology').config.faceType, 'Quad')
  assert.equal(result.workflow.nodes.find((node) => node.id === 'texture').config.resolution, '4K')
  assert.deepEqual(result.changedNodeIds, ['retopology', 'texture'])
})

test('fills explicit parameters omitted by DeepSeek without changing workflow structure', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow with retopology and texture').workflow
  const originalNodeCount = workflow.nodes.length
  const originalEdgeCount = workflow.edges.length
  const replies = [
    response({ choices: [{ message: { role: 'assistant', tool_calls: [
      { id: 'call-1', type: 'function', function: { name: 'update_node_parameters', arguments: JSON.stringify({ nodeId: 'retopology', parameters: { faceLimit: 6000 } }) } },
      { id: 'call-2', type: 'function', function: { name: 'update_node_parameters', arguments: JSON.stringify({ nodeId: 'texture', parameters: { resolution: '4K' } }) } },
    ] } }] }),
    response({ choices: [{ message: { role: 'assistant', content: 'Updated.' } }] }),
  ]

  const result = await runDeepSeekAgent({
    apiKey: 'test-key',
    message: '把 Retopology 的目标面数改成 6000，面类型改成 Quad；同时把纹理分辨率改成 4K',
    workflow,
    fetchImpl: async () => replies.shift(),
  })

  assert.equal(result.workflow.nodes.find((node) => node.id === 'retopology').config.faceType, 'Quad')
  assert.equal(result.workflow.nodes.length, originalNodeCount)
  assert.equal(result.workflow.edges.length, originalEdgeCount)
  assert.equal(result.structureChanged, false)
})

test('rejects invalid parameter values requested by the model', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow').workflow
  const fetchImpl = async () => response({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'update_node_parameters', arguments: JSON.stringify({ nodeId: 'text-to-3d', parameters: { faceCount: 999999 } }) } }] } }] })

  await assert.rejects(
    runDeepSeekAgent({ apiKey: 'test-key', message: 'Use lots of faces', workflow, fetchImpl }),
    /generated face count must be 1000-50000/,
  )
})

test('does not expose the API key in upstream errors', async () => {
  const workflow = planWorkflow('Create a text-to-3D workflow').workflow
  await assert.rejects(
    runDeepSeekAgent({ apiKey: 'secret-key', message: 'Change it', workflow, fetchImpl: async () => response({ error: 'bad key' }, 401) }),
    (error) => error.message === 'DeepSeek request failed with status 401.' && !error.message.includes('secret-key'),
  )
})
