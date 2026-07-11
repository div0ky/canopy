import { copyFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = process.cwd()
const assets = ['LICENSE', 'NOTICE']

if (process.argv.includes('--clean')) {
  await Promise.all(assets.map((asset) => rm(path.join(packageRoot, asset), { force: true })))
} else {
  await Promise.all(
    assets.map((asset) =>
      copyFile(path.join(repositoryRoot, asset), path.join(packageRoot, asset)),
    ),
  )
}
