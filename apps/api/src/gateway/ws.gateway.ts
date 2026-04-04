import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { WS_EVENTS } from './ws.events';
import type {
  WsMessageNew,
  WsMessageStatus,
  WsConversationUpdated,
  WsAiTyping,
  WsWhatsAppQr,
  WsWhatsAppConnected,
  WsWhatsAppDisconnected,
  WsNotificationNew,
} from '@wacrm/shared';

@WebSocketGateway({
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? [`https://${process.env.DOMAIN}`]
      : true,
    credentials: true,
  },
  namespace: '/',
})
export class WsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WsGateway.name);

  constructor(private readonly jwt: JwtService) {}

  // ── Connection lifecycle ───────────────────────────────────────────────────

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.query?.token as string) ||
        (client.handshake.headers?.authorization?.replace('Bearer ', '') ?? '');

      if (!token) {
        this.logger.warn(`Unauthorized WS: No token provided (Client: ${client.id})`);
        return client.disconnect();
      }

      const payload = this.jwt.verify<{ sub: string; cid: string }>(token, {
        secret: process.env.JWT_SECRET,
      });

      // Each client joins a company-scoped room
      const room = `company:${payload.cid}`;
      await client.join(room);
      client.data.companyId = payload.cid;
      client.data.userId = payload.sub;

      this.logger.debug(`Client connected: ${client.id} → room ${room}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Unauthorized WS: Invalid token (Client: ${client.id}, Error: ${msg})`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  // ── Emit helpers (called from services) ───────────────────────────────────

  emitToCompany(companyId: string, event: string, data: unknown) {
    this.server.to(`company:${companyId}`).emit(event, data);
  }

  emitMessageNew(companyId: string, payload: WsMessageNew) {
    this.emitToCompany(companyId, WS_EVENTS.MESSAGE_NEW, payload);
  }

  emitMessageStatus(companyId: string, payload: WsMessageStatus) {
    this.emitToCompany(companyId, WS_EVENTS.MESSAGE_STATUS, payload);
  }

  emitConversationUpdated(companyId: string, payload: WsConversationUpdated) {
    this.emitToCompany(companyId, WS_EVENTS.CONVERSATION_UPDATED, payload);
  }

  emitAiTyping(companyId: string, payload: WsAiTyping) {
    this.emitToCompany(companyId, WS_EVENTS.AI_TYPING, payload);
  }

  emitWhatsAppQr(companyId: string, payload: WsWhatsAppQr) {
    this.emitToCompany(companyId, WS_EVENTS.WA_QR, payload);
  }

  emitWhatsAppConnected(companyId: string, payload: WsWhatsAppConnected) {
    this.emitToCompany(companyId, WS_EVENTS.WA_CONNECTED, payload);
  }

  emitWhatsAppDisconnected(companyId: string, payload: WsWhatsAppDisconnected) {
    this.emitToCompany(companyId, WS_EVENTS.WA_DISCONNECTED, payload);
  }

  emitNotification(companyId: string, payload: WsNotificationNew) {
    this.emitToCompany(companyId, WS_EVENTS.NOTIFICATION_NEW, payload);
  }

  // ── Client-to-server messages ──────────────────────────────────────────────

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit('pong', { time: new Date().toISOString() });
  }
}
