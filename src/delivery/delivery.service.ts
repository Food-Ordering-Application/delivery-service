import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_SERVICE, ORDER_SERVICE } from 'src/constants';
import { ClientProxy } from '@nestjs/microservices';
import { DriverAcceptOrderDto } from './dto';
import { IDriverAcceptOrderResponse } from './interfaces';
import { UpdateDriverForOrderEventPayload } from './events/update-driver-for-order.event';
import { OrderEventPayload } from './events/order.event';
import { DispatchDriverEventPayload } from './events/dispatch-driver.event';

const MOCK_DRIVER_ID = 'a22f3f78-be7f-11eb-8529-0242ac130003';
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
    this.orderServiceClient.emit('updateDriverForOrderEvent', payload);
    this.logger.log(payload, 'noti: updateDriverForOrderEvent');
  }

  async sendDispatchDriverEvent(payload: DispatchDriverEventPayload) {
    this.notificationServiceClient.emit('dispatchDriverEvent', payload);
    this.logger.log(payload, 'noti: dispatchDriverEvent');
  }

  async acceptOrder(
    acceptOrderDto: DriverAcceptOrderDto,
  ): Promise<IDriverAcceptOrderResponse> {
    const { driverId, orderId } = acceptOrderDto;

    // TODO: check driverId with id of dispatcher
    this.sendUpdateDriverForOrderEvent({ driverId, orderId });

    return {
      status: HttpStatus.OK,
      message: 'Accept order successfully',
    };
  }

  async handleDispatchDriver(order: OrderEventPayload) {
    const { id } = order;
    // TODO: calculate and dispatch driver
    this.sendDispatchDriverEvent({ orderId: id, driverId: MOCK_DRIVER_ID });
  }
}
