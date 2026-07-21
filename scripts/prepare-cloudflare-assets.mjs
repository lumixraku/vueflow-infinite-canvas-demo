import { cp, mkdir, rm } from 'node:fs/promises'

await rm('dist-cloudflare', { recursive: true, force: true })
await mkdir('dist-cloudflare', { recursive: true })
await cp('dist', 'dist-cloudflare', { recursive: true, filter: (source) => !source.includes('/models/') })
