import { Controller } from '@nestjs/common';
import { DeliveryService } from './delivery.service';

@Controller()
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  // @MessagePattern('createDelivery')
  // createDelivery(
  //   @Payload() createDeliveryDto: CreateDeliveryDto,
  // ): Promise<ICreateDeliveryResponse> {
  //   return this.deliveryService.create(createDeliveryDto);
  // }
}
