import { DeliveryModule } from './delivery/delivery.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [DeliveryModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
