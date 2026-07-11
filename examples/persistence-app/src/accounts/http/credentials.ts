import type { HttpRequest } from '@doxajs/core'
import { z } from 'zod'

const Credentials = z.object({
  email: z.string(),
  password: z.string(),
})

export async function credentials(request: HttpRequest): Promise<{
  readonly email: string
  readonly password: string
}> {
  return await request.validate(Credentials, await request.json())
}
