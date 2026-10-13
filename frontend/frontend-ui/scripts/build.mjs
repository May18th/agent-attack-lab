import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { configurePagesApi } from './build-environment.mjs'

const pagesBuild = configurePagesApi()
if (pagesBuild) {
  console.log(`Cloudflare Pages branch ${pagesBuild.branch}: using ${pagesBuild.api}`)
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const commands = [
  [new URL('../node_modules/typescript/bin/tsc', import.meta.url), ['-b']],
  [new URL('../node_modules/vite/bin/vite.js', import.meta.url), ['build']],
]

for (const [command, args] of commands) {
  const result = spawnSync(process.execPath, [fileURLToPath(command), ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  })

  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
