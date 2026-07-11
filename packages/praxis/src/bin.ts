#!/usr/bin/env node
import { runPraxis } from './index.js'

process.exitCode = await runPraxis(process.argv.slice(2))
