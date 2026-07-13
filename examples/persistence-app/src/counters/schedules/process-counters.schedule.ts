import { Schedule } from '@doxajs/core'

import { ProcessCounterJob } from '../jobs/process-counter.job.js'

export class ProcessCountersSchedule extends Schedule {
  static override readonly id = 'process-counters'
  static override readonly access = 'public'
  static override readonly job = ProcessCounterJob
  static override readonly everySeconds = 3_600
  static override readonly misfire = 'catch-up-once'
  static override readonly input = { key: 'scheduled-counter-sweep' }
}
