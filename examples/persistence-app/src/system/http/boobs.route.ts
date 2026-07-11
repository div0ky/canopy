import { type HttpRequest, Route } from '@canopy/core'
import { BoobJob } from './boob.job.js'
import { BoobPinged } from './boob.event.js'

export class BoobsRoute extends Route {
  static override readonly id = 'boobs'
  static override readonly access = 'public'
  readonly method = 'GET'
  readonly path = '/boobs'

  async handle(_request: HttpRequest): Promise<string> {
    const message = "b00bs (.)(.)";
    
    for (let i = 0; i < 5; i++) {
        await BoobJob.dispatch(message);
    }

    await BoobPinged.dispatch();
    return message;
  }
}
