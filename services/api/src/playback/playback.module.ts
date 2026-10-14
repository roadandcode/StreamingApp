import { type DynamicModule, Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { PlaybackController } from './playback.controller';
import { PlaybackService } from './playback.service';

@Module({})
export class PlaybackModule {
  /** `media` is the app's MediaModule instance. */
  static register(media: DynamicModule): DynamicModule {
    return {
      module: PlaybackModule,
      imports: [media, EntitlementsModule],
      controllers: [PlaybackController],
      providers: [PlaybackService],
      exports: [PlaybackService],
    };
  }
}
