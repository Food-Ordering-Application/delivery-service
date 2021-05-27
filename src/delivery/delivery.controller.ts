import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { DeliveryService } from './delivery.service';
import { DriverAcceptOrderDto } from './dto';
import { OrderEventPayload } from './events/order.event';
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

  @EventPattern('orderConfirmedByRestaurantEvent')
  async handleDispatchDriver(@Payload() order: OrderEventPayload) {
    this.deliveryService.handleDispatchDriver(order);
  }
}
