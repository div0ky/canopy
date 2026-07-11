import { Configuration } from '@doxajs/core'

export class WorkerConfig extends Configuration {
  concurrency = 2
  failStartup = false
}
