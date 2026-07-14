import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const dataDirectory = path.join(root, 'data')
const seedDirectory = path.join(root, 'seed')
const collections = ['workflows', 'conversations', 'runs', 'fragments']

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

  async function persist(collection) {
    const destination = path.join(dataDirectory, `${collection}.json`)
    const temporary = `${destination}.tmp`
    await writeFile(temporary, `${JSON.stringify(state[collection], null, 2)}\n`)
    await rename(temporary, destination)
  }

  return { state, persist }
}
