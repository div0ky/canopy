import { Feature } from '@canopy/core'

import { HttpPinged } from './events/http-pinged.js'
import { HealthRoute } from './http/health.route.js'
import { HelloRoute } from './http/hello.route.js'
import { HomeRoute } from './http/home.route.js'
import { PingRoute } from './http/ping.route.js'
import { RecordHttpPinged } from './listeners/record-http-pinged.js'
import { SystemEventRecorder } from './support/system-event-recorder.js'
import { DailyHealthCheckSchedule } from './schedules/daily-health-check.schedule.js'
import { DescribeCanopy } from './commands/describe-canopy.js'
import { PongRoute } from './http/pong.route.js'

export class SystemFeature extends Feature {
  id = 'system'
  providers = [SystemEventRecorder]
  routes = [HomeRoute, HealthRoute, HelloRoute, PingRoute, PongRoute]
  events = [HttpPinged]
  listeners = [RecordHttpPinged]
  schedules = [DailyHealthCheckSchedule]
  commands = [DescribeCanopy]
}
