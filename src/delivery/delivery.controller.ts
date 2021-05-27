import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { DeliveryService } from './delivery.service';
import { DriverAcceptOrderDto } from './dto';
import { IDriverAcceptOrderResponse } from './interfaces';

@Controller()
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @MessagePattern('driverAcceptOrder')
  async acceptOrder(
    @Payload() acceptOrderDto: DriverAcceptOrderDto,
  ): Promise<IDriverAcceptOrderResponse> {
    return this.deliveryService.acceptOrder(acceptOrderDto);
  }
}
