import { type DynamicModule, Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { AdminContentController, AdminUsersController } from './admin.controller';
import { AdminContentService } from './admin-content.service';
import { AdminUsersService } from './admin-users.service';

@Module({})
export class AdminModule {
  /** `media` and `billing` are the app's MediaModule and BillingModule instances. */
  static register(media: DynamicModule, billing: DynamicModule): DynamicModule {
    return {
      module: AdminModule,
      imports: [media, billing, DevicesModule],
      controllers: [AdminContentController, AdminUsersController],
      providers: [AdminContentService, AdminUsersService],
    };
  }
}
