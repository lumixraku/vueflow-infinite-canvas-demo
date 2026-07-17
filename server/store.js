import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const dataDirectory = path.join(root, 'data')
const seedDirectory = path.join(root, 'seed')
const collections = ['workflows', 'conversations', 'runs', 'fragments']
const retiredNodeTypes = new Set(['save-asset', 'export-model'])

export function migrateWorkflow(workflow, now = () => new Date().toISOString()) {
  const migrated = structuredClone(workflow)
  const retainedNodes = migrated.nodes.filter((node) => !retiredNodeTypes.has(node.type))
  const retainedNodeIds = new Set(retainedNodes.map((node) => node.id))
  let changed = retainedNodes.length !== migrated.nodes.length

  migrated.nodes = retainedNodes.map((node) => {
    if (node.type !== 'model-preview' || !Object.hasOwn(node.config || {}, 'background')) return node
    const config = { ...node.config }
    delete config.background
    changed = true
    return { ...node, config }
  })
  const retainedEdges = migrated.edges.filter((edge) => retainedNodeIds.has(edge.source.nodeId) && retainedNodeIds.has(edge.target.nodeId))
  if (retainedEdges.length !== migrated.edges.length) changed = true
  migrated.edges = retainedEdges

  const description = migrated.description
    ?.replace(/, review, save, and export/, ', and review')
    .replace(/, review (a production-ready)/, ', and review $1')
  if (description !== migrated.description) {
    migrated.description = description
    changed = true
  }
  if (!changed) return workflow
  migrated.revision = (migrated.revision || 0) + 1
  migrated.updatedAt = now()
  return migrated
}

export async function createStore() {
  await mkdir(dataDirectory, { recursive: true })

  for (const collection of collections) {
    const destination = path.join(dataDirectory, `${collection}.json`)
    try {
      await access(destination)
    } catch {
      const seed = await readFile(path.join(seedDirectory, `${collection}.json`), 'utf8')
      await writeFile(destination, seed)
    }
  }

  const state = Object.fromEntries(await Promise.all(collections.map(async (collection) => {
    const contents = await readFile(path.join(dataDirectory, `${collection}.json`), 'utf8')
    return [collection, JSON.parse(contents)]
  })))
  const persistQueues = new Map()

  async function persist(collection) {
    const queued = (persistQueues.get(collection) || Promise.resolve()).catch(() => {}).then(async () => {
      const destination = path.join(dataDirectory, `${collection}.json`)
      const temporary = `${destination}.tmp`
      await writeFile(temporary, `${JSON.stringify(state[collection], null, 2)}\n`)
      await rename(temporary, destination)
    })
    persistQueues.set(collection, queued)
    return queued
  }

  const workflows = state.workflows.map((workflow) => migrateWorkflow(workflow))
  if (workflows.some((workflow, index) => workflow !== state.workflows[index])) {
    state.workflows = workflows
    await persist('workflows')
  }

  return { state, persist }
}
