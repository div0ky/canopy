import { runDevelopmentRuntime } from './index.js'

const cwd = process.argv[2]
const encodedArguments = process.argv[3]

if (!cwd || !encodedArguments)
  throw new Error('The Arbor development child requires cwd and arguments.')

const arguments_ = JSON.parse(encodedArguments) as unknown
if (!Array.isArray(arguments_) || !arguments_.every((argument) => typeof argument === 'string')) {
  throw new Error('The Arbor development child received invalid arguments.')
}

await runDevelopmentRuntime(cwd, arguments_)
