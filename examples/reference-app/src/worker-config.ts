import { Configuration } from '@canopy/core'

export class WorkerConfig extends Configuration {
  concurrency = 2
  failStartup = false
}
