import { Configuration } from '@canopy/core'

export class AppConfig extends Configuration {
  environment: 'development' | 'test' | 'production' = 'development'
  port = 3000
}
