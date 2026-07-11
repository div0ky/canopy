#!/usr/bin/env node
import { runArbor } from './index.js'

process.exitCode = await runArbor(process.argv.slice(2))
