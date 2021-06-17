import { IUpdateDriverActiveStatusResponse } from './interfaces/update-driver-active-status-response.interface';
import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { DeliveryService } from './delivery.service';
import {
  GetDriverActiveStatusDto,
  DriverAcceptOrderDto,
  UpdateDriverActiveStatusDto,
  UpdateDriverLocationDto,
  DriverDeclineOrderDto,
} from './dto';
import { OrderEventPayload } from './events/order.event';
import {
  IDriverAcceptOrderResponse,
  IDriverDeclineOrderResponse,
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

  @MessagePattern('driverDeclineOrder')
  async declineOrder(
    @Payload() driverDeclineOrderDto: DriverDeclineOrderDto,
  ): Promise<IDriverDeclineOrderResponse> {
    return this.deliveryService.declineOrder(driverDeclineOrderDto);
  }

  @EventPattern('orderConfirmedByRestaurantEvent')
  async handleDispatchDriver(@Payload() order: OrderEventPayload) {
    this.deliveryService.handleDispatchDriver(order);
  }

  @EventPattern('orderHasBeenCompletedEvent')
  async handleDriverCompleteOrder(@Payload() order: OrderEventPayload) {
    this.deliveryService.handleDriverCompleteOrder(order);
  }

  @EventPattern('updateDriverLocation')
  async updateDriverLocation(
    @Payload() updateDriverLocationDto: UpdateDriverLocationDto,
  ) {
    this.deliveryService.updateDriverLocation(updateDriverLocationDto);
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
