import {
  Inject,
  Injectable,
  type CallHandler,
  type CanActivate,
  type ExecutionContext as NestExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Authentication } from '../auth/auth.js';
import { ExecutionContext, type Actor } from '../context/execution-context.js';

interface CanopyRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  canopyActor?: Actor;
  readonly id?: string;
  readonly locale?: string;
}

@Injectable()
export class CanopyAuthGuard implements CanActivate {
  public constructor(@Inject(Authentication) private readonly authentication: Authentication) {}

  public async canActivate(context: NestExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CanopyRequest>();
    const authorization = request.headers['authorization'];
    const header = Array.isArray(authorization) ? authorization[0] : authorization;
    if (!header?.startsWith('Bearer ')) return false;
    const token = header.slice(7);
    request.canopyActor =
      token.includes('.') && token.split('.').length === 2
        ? this.authentication.verifyServiceToken(token)
        : await this.authentication.verifyJwt(token);
    return true;
  }
}

@Injectable()
export class CanopyContextInterceptor implements NestInterceptor {
  public constructor(@Inject(ExecutionContext) private readonly context: ExecutionContext) {}

  public intercept(nestContext: NestExecutionContext, next: CallHandler): Observable<unknown> {
    const request = nestContext.switchToHttp().getRequest<CanopyRequest>();
    return new Observable((subscriber) => {
      void this.context
        .run(
          {
            ...(request.canopyActor ? { actor: request.canopyActor } : {}),
            ...(request.id ? { correlationId: request.id } : {}),
            ...(request.locale ? { locale: request.locale } : {}),
          },
          () => {
            const subscription = next.handle().subscribe(subscriber);
            return () => subscription.unsubscribe();
          },
        )
        .catch((error: unknown) => subscriber.error(error));
    });
  }
}
