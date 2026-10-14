import { type DynamicModule, Module } from '@nestjs/common';
import { type Env, isFakeMediaEnabled } from '../config/env.schema';
import { AwsMediaProvider } from './aws-media-provider';
import { DevMediaController } from './dev-media.controller';
import { FakeMediaProvider } from './fake-media-provider';
import { MEDIA_PROVIDER } from './media-provider';

@Module({})
export class MediaModule {
  /** Selects the provider from MEDIA_PROVIDER; the dev routes exist only with the fake provider. */
  static register(env: Env): DynamicModule {
    const fake = isFakeMediaEnabled(env);
    return {
      module: MediaModule,
      controllers: fake ? [DevMediaController] : [],
      providers: [
        fake
          ? { provide: MEDIA_PROVIDER, useClass: FakeMediaProvider }
          : { provide: MEDIA_PROVIDER, useClass: AwsMediaProvider },
      ],
      exports: [MEDIA_PROVIDER],
    };
  }
}
