import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { Authentication, validate } from '@evergreen/canopy';
import { z } from 'zod';

const TokenRequest = z.object({ userId: z.string().uuid() });

@Controller()
export class ApiController {
  public constructor(@Inject(Authentication) private readonly authentication: Authentication) {}

  @Get('health')
  public health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Post('auth/token')
  public async token(@Body() input: unknown): Promise<{ data: { token: string } }> {
    const { userId } = validate(TokenRequest, input);
    return { data: { token: await this.authentication.issueJwt({ id: userId, type: 'user' }) } };
  }
}
