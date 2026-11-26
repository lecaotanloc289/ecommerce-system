import { type DynamicModule, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LiveStreamProviderSchema, NodeEnvSchema } from '../config/env';
import { DevLiveSessionsController } from './dev-live-sessions.controller';
import { LiveEventsPublisher } from './live-events.publisher';
import { LiveSessionMapper } from './live-session.mapper';
import { LiveSessionService } from './live-session.service';
import { LiveWebhooksController } from './live-webhooks.controller';
import { LiveWebhooksService } from './live-webhooks.service';
import { PlatformLiveSessionsController } from './platform-live-sessions.controller';
import { PublicLiveSessionsController } from './public-live-sessions.controller';
import { LiveChatService } from './realtime/live-chat.service';
import { LiveReactionsService } from './realtime/live-reactions.service';
import { LiveRealtimeController } from './realtime/live-realtime.controller';
import {
  DEFAULT_LIVE_REALTIME_OPTIONS,
  LIVE_REALTIME_OPTIONS,
} from './realtime/live-realtime.options';
import { LiveRealtimeService } from './realtime/live-realtime.service';
import { LiveSessionStatusCache, LiveUserRateLimiter } from './realtime/live-realtime-guards';
import { LiveSseService } from './realtime/live-sse.service';
import { LiveViewersService } from './realtime/live-viewers.service';
import { VendorLiveModerationController } from './realtime/vendor-live-moderation.controller';
import { STREAM_PROVIDER, streamProviderProvider } from './stream-provider.provider';
import { VendorLiveSessionsController } from './vendor-live-sessions.controller';

export interface LiveModuleOptions {
  /** Register `/dev/live-sessions/*` (encoder simulation). See `devLiveRoutesEnabled`. */
  devRoutes: boolean;
}

/**
 * Dev routes exist only with the fake provider outside production. Reads the raw environment
 * because controllers are fixed when the module graph is built (before ENV is injectable); uses
 * the same Zod schemas/defaults as `parseEnv`.
 */
export function devLiveRoutesEnabled(source: Record<string, string | undefined>): boolean {
  const nodeEnv = NodeEnvSchema.safeParse(source.NODE_ENV || undefined);
  const provider = LiveStreamProviderSchema.safeParse(source.LIVE_STREAM_PROVIDER || undefined);
  return (
    nodeEnv.success && provider.success && nodeEnv.data !== 'production' && provider.data === 'fake'
  );
}

/**
 * Live shopping: sessions, state machine, provider webhooks, and realtime (`realtime/`: SSE
 * event stream, chat, reactions, viewer presence, chat moderation).
 */
@Module({})
export class LiveModule {
  static register(options: LiveModuleOptions): DynamicModule {
    return {
      module: LiveModule,
      imports: [AuthModule],
      controllers: [
        VendorLiveSessionsController,
        PublicLiveSessionsController,
        PlatformLiveSessionsController,
        LiveWebhooksController,
        LiveRealtimeController,
        VendorLiveModerationController,
        ...(options.devRoutes ? [DevLiveSessionsController] : []),
      ],
      providers: [
        streamProviderProvider,
        LiveSessionMapper,
        LiveEventsPublisher,
        LiveSessionService,
        LiveWebhooksService,
        { provide: LIVE_REALTIME_OPTIONS, useValue: DEFAULT_LIVE_REALTIME_OPTIONS },
        LiveSessionStatusCache,
        LiveUserRateLimiter,
        LiveRealtimeService,
        LiveViewersService,
        LiveSseService,
        LiveChatService,
        LiveReactionsService,
      ],
      exports: [STREAM_PROVIDER, LiveSessionMapper, LiveEventsPublisher, LiveSessionService],
    };
  }
}
