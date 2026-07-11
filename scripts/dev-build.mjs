import path from 'node:path'

import { compileApplication } from '@doxajs/compiler'

const workspace = process.cwd()
const applicationRoot = path.join(workspace, 'examples/persistence-app')

await compileApplication({
  tsconfigPath: path.join(applicationRoot, 'tsconfig.json'),
  applicationFile: path.join(applicationRoot, 'src/application.ts'),
  sourceRoot: path.join(applicationRoot, 'src'),
  outputRoot: path.join(applicationRoot, 'dist'),
  artifactsDirectory: path.join(workspace, '.doxa/dev'),
})
