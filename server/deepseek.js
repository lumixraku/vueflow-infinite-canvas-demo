import { describeWorkflowParameters, updateNodeParameters, workflowParameterJsonSchema } from './workflow-parameters.js'
import { buildWorkflowStructure, nodeDefaults, planWorkflow } from './planner.js'

const systemPrompt = `You are the builder agent for a 3D production workflow canvas. You can build workflow structures and adjust node parameters. Use tools for every workflow change; never claim a change unless a tool succeeded.

When the user asks to create, build, rebuild, or design a workflow, call build_workflow with the complete ordered list of stages. The server automatically creates one frame, places all stages inside it, connects compatible ports, and lays out the result. For a common text-to-image-to-3D workflow use reference-image, prompt, generate-image, generate-model, model-preview. For direct text-to-3D use prompt, text-to-3d, model-preview. Add retopology and texture before model-preview when requested.

Use get_workflow_structure when the current nodes or available stage types are unclear. Use get_workflow_parameters when parameter names, node IDs, ranges, or options are unclear. Apply every parameter explicitly requested by the user. Group all requested changes for the same node into one update_node_parameters call, use separate calls for different nodes, and verify every requested change appears in successful tool results before replying. Reply concisely in the user's language and summarize the nodes and connections actually created or changed.`

const workflowStageTypes = Object.keys(nodeDefaults)

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_workflow_structure',
      description: 'Inspect the current workflow nodes and connections, plus every stage type that can be created.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'build_workflow',
      description: 'Build or rebuild the current workflow from an ordered list of stages. All stages are placed inside one frame and compatible stages are connected automatically.',
      parameters: {
        type: 'object',
        properties: {
          stages: {
            type: 'array',
            description: 'Complete ordered stage list. Do not include frame; it is created automatically.',
            items: { type: 'string', enum: workflowStageTypes },
            minItems: 1,
          },
        },
        required: ['stages'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_workflow_parameters',
      description: 'List current workflow nodes and their adjustable parameters, valid ranges, and options.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_node_parameters',
      description: 'Update validated parameters on one existing workflow node. You must use the exact nodeId returned by get_workflow_structure; do not use a display name or node type.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Exact node ID from the current workflow.' },
          parameters: workflowParameterJsonSchema(),
        },
        required: ['nodeId', 'parameters'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_workflow_stage',
      description: 'Add a Retopology or Texture Model stage when it does not already exist.',
      parameters: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['retopology', 'texture'] } },
        required: ['type'],
        additionalProperties: false,
      },
    },
  },
]

export class DeepSeekError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.status = status
  }
}

function parseArguments(call) {
  try {
    return JSON.parse(call.function.arguments || '{}')
  } catch {
    throw new DeepSeekError('DeepSeek returned invalid tool arguments.')
  }
}

export async function runDeepSeekAgent({ apiKey, message, workflow, history = [], fetchImpl = fetch, baseUrl = 'https://api.deepseek.com', model = 'deepseek-v4-flash', maxRounds = 5 }) {
  if (!apiKey) throw new DeepSeekError('DeepSeek is not configured.', 503)
  baseUrl ||= 'https://api.deepseek.com'
  model ||= 'deepseek-v4-flash'
  let nextWorkflow = structuredClone(workflow)
  let structureChanged = false
  const changes = []
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-20).map(({ role, content }) => ({ role, content })),
    { role: 'user', content: message },
  ]

  for (let round = 0; round < maxRounds; round += 1) {
    let response
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', stream: false }),
        signal: AbortSignal.timeout(30000),
      })
    } catch {
      throw new DeepSeekError('The DeepSeek service is unavailable.', 503)
    }
    if (!response.ok) throw new DeepSeekError(`DeepSeek request failed with status ${response.status}.`, response.status === 429 ? 503 : 502)
    const payload = await response.json()
    const assistant = payload.choices?.[0]?.message
    if (!assistant) throw new DeepSeekError('DeepSeek returned an invalid response.')
    if (!assistant.tool_calls?.length) {
      if (changes.length && nextWorkflow.revision === workflow.revision) nextWorkflow.revision += 1
      if (changes.length) nextWorkflow.updatedAt = new Date().toISOString()
      return {
        workflow: nextWorkflow,
        reply: assistant.content || (changes.length ? 'Workflow updated.' : 'No workflow changes were made. Use the workflow tools to make a change.'),
        changedNodeIds: [...new Set(changes.map((change) => change.nodeId))],
        structureChanged,
      }
    }

    messages.push({ role: 'assistant', content: assistant.content || '', tool_calls: assistant.tool_calls })
    for (const call of assistant.tool_calls) {
      const args = parseArguments(call)
      let result
      if (call.function.name === 'get_workflow_structure') {
        result = {
          nodes: nextWorkflow.nodes.map(({ id, type, name }) => ({ id, type, name })),
          edges: nextWorkflow.edges,
          availableStageTypes: workflowStageTypes,
        }
      } else if (call.function.name === 'build_workflow') {
        if (!Array.isArray(args.stages) || !args.stages.length || args.stages.some((type) => !workflowStageTypes.includes(type))) {
          throw new DeepSeekError('DeepSeek requested an invalid workflow structure.')
        }
        nextWorkflow = buildWorkflowStructure(message, args.stages, nextWorkflow)
        structureChanged = true
        for (const node of nextWorkflow.nodes) changes.push({ nodeId: node.id, added: true })
        result = {
          frameId: nextWorkflow.nodes.find((node) => node.type === 'frame')?.id,
          nodes: nextWorkflow.nodes.filter((node) => node.type !== 'frame').map(({ id, type, name }) => ({ id, type, name })),
          edges: nextWorkflow.edges.map((edge) => ({ source: edge.source.nodeId, target: edge.target.nodeId })),
        }
      } else if (call.function.name === 'get_workflow_parameters') {
        result = {
          nodes: nextWorkflow.nodes.map(({ id, type, name }) => ({ id, type, name })),
          parameters: describeWorkflowParameters(nextWorkflow),
        }
      } else if (call.function.name === 'update_node_parameters') {
        const applied = updateNodeParameters(nextWorkflow, args.nodeId, args.parameters)
        changes.push(...applied)
        result = { changes: applied }
      } else if (call.function.name === 'add_workflow_stage') {
        if (!['retopology', 'texture'].includes(args.type)) throw new DeepSeekError('DeepSeek requested an unsupported workflow stage.')
        const planned = planWorkflow(`Add ${args.type}`, nextWorkflow)
        nextWorkflow = planned.workflow
        structureChanged ||= planned.structureChanged
        for (const nodeId of planned.changedNodeIds) changes.push({ nodeId, added: true })
        result = { addedNodeIds: planned.changedNodeIds }
      } else {
        throw new DeepSeekError(`DeepSeek requested unsupported tool "${call.function.name}".`)
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }
  throw new DeepSeekError('DeepSeek exceeded the tool-call limit.')
}
