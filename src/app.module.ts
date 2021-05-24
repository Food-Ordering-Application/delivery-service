import { DeliveryModule } from './delivery/delivery.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [DeliveryModule, ConfigModule.forRoot()],
  controllers: [],
  providers: [],
})
export class AppModule {}
