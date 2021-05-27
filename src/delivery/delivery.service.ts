import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_SERVICE, ORDER_SERVICE } from 'src/constants';
import { ClientProxy } from '@nestjs/microservices';
import { DriverAcceptOrderDto } from './dto';
import { IDriverAcceptOrderResponse } from './interfaces';
import { UpdateDriverForOrderEventPayload } from './events/update-driver-for-order.event';

@Injectable()
export class DeliveryService {
  constructor(
    @Inject(NOTIFICATION_SERVICE)
    private notificationServiceClient: ClientProxy,
    @Inject(ORDER_SERVICE)
    private orderServiceClient: ClientProxy,
  ) {}

  private readonly logger = new Logger('DeliveryService');

  async sendUpdateDriverForOrderEvent(
    payload: UpdateDriverForOrderEventPayload,
  ) {
    this.notificationServiceClient.emit('updateDriverForOrder', payload);
  }

  async acceptOrder(
    acceptOrderDto: DriverAcceptOrderDto,
  ): Promise<IDriverAcceptOrderResponse> {
    const { driverId, orderId } = acceptOrderDto;

    this.sendUpdateDriverForOrderEvent({ driverId, orderId });

    return {
      status: HttpStatus.OK,
      message: 'Accept order successfully',
    };
  }
}
