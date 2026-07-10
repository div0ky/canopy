import { Authentication } from '@evergreen/canopy';
import { Inject } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { socketBroadcaster } from './runtime.js';

@WebSocketGateway({ cors: { origin: false }, namespace: '/orders' })
export class OrdersGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  private server!: Server;

  public constructor(@Inject(Authentication) private readonly authentication: Authentication) {}

  public afterInit(server: Server): void {
    socketBroadcaster.connect(server);
  }

  public async handleConnection(client: Socket): Promise<void> {
    const token =
      typeof client.handshake.auth['token'] === 'string'
        ? client.handshake.auth['token']
        : undefined;
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const actor = await this.authentication.verifyJwt(token);
      await client.join([`orders.${actor.id}`, `users.${actor.id}`]);
    } catch {
      client.disconnect(true);
    }
  }
}
