import { Schedule } from '@doxajs/core'

import { ProcessCounterJob } from '../../counters/jobs/process-counter.job.js'

export class DailyHealthCheckSchedule extends Schedule {
  static override readonly id = 'daily-health-check'
  static override readonly access = 'public'
  static override readonly job = ProcessCounterJob
  static override readonly cron = '0 6 * * *'
  static override readonly timeZone = 'America/Chicago'
  static override readonly input = { key: 'daily-health-check' }
}
