import { IUpdateDriverActiveStatusResponse } from './interfaces/update-driver-active-status-response.interface';
import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { DeliveryService } from './delivery.service';
import {
  GetDriverActiveStatusDto,
  DriverAcceptOrderDto,
  UpdateDriverActiveStatusDto,
} from './dto';
import { OrderEventPayload } from './events/order.event';
import {
  IDriverAcceptOrderResponse,
  IGetDriverActiveStatusResponse,
} from './interfaces';

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

  @MessagePattern('getDriverActiveStatus')
  async getDriverActiveStatus(
    @Payload() getDriverActiveStatusDto: GetDriverActiveStatusDto,
  ): Promise<IGetDriverActiveStatusResponse> {
    return this.deliveryService.getDriverActiveStatus(getDriverActiveStatusDto);
  }

  @MessagePattern('updateDriverActiveStatus')
  async updateDriverActiveStatus(
    @Payload() updateDriverActiveStatusDto: UpdateDriverActiveStatusDto,
  ): Promise<IUpdateDriverActiveStatusResponse> {
    return this.deliveryService.updateDriverActiveStatus(
      updateDriverActiveStatusDto,
    );
  }
}
