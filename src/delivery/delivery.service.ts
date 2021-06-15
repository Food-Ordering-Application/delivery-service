import {
  UpdateDriverLocationDto,
  Location,
  UpdateDriverActiveStatusDto,
  GetDriverActiveStatusDto,
} from './dto/';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  NOTIFICATION_SERVICE,
  ORDER_SERVICE,
  USER_SERVICE,
} from 'src/constants';
import { ClientProxy } from '@nestjs/microservices';
import { DriverAcceptOrderDto } from './dto';
import { IDriverAcceptOrderResponse } from './interfaces';
import { InjectRedis, Redis } from '@nestjs-modules/ioredis';
import {
  DispatchDriverEventPayload,
  OrderEventPayload,
  OrderLocationUpdateEventPayload,
  UpdateDriverForOrderEventPayload,
} from './events';

const MOCK_DRIVER_ID = 'a22f3f78-be7f-11eb-8529-0242ac130003';
@Injectable()
export class DeliveryService {
  constructor(
    @Inject(NOTIFICATION_SERVICE)
    private notificationServiceClient: ClientProxy,
    @Inject(ORDER_SERVICE)
    private orderServiceClient: ClientProxy,
    @Inject(USER_SERVICE)
    private userServiceClient: ClientProxy,

    @InjectRedis()
    private readonly redis: Redis,
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

  async sendOrderLocationUpdateEvent(payload: OrderLocationUpdateEventPayload) {
    this.notificationServiceClient.emit('deliveryLocationUpdateEvent', payload);
    this.logger.log(payload, 'noti: deliveryLocationUpdateEvent');
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

    //TODO: Check driver đủ điều kiện accept đơn
    // const response = await this.userServiceClient.send(
    //   'checkDriverAccountBalance',
    //   {
    //     order,
    //     driverId: anyDriverId,
    //   },
    // );
    // TODO: calculate and dispatch driver
    this.sendDispatchDriverEvent({ orderId: id, driverId: MOCK_DRIVER_ID });
  }

  async updateDriverLocation(updateDriverLocationDto: UpdateDriverLocationDto) {
    const { driverId, latitude, longitude } = updateDriverLocationDto;
    const location: Location = { latitude, longitude };

    // prepare location json for precise location update
    const jsonLocation = JSON.stringify(location);

    // calculate geo hash for update driver set by location
    const geoHash = Location.toS2CellId(location).toToken();
    const currentTimestamp = Date.now();

    const preciseLocationKey = `driver:${driverId}:location`;
    const geoKey = geoHash;
    const orderKey = `driver:${driverId}:order`;

    const pipeline = this.redis.pipeline();

    // update location
    pipeline.set(preciseLocationKey, jsonLocation);

    // update driver set by location
    pipeline.zadd(geoKey, driverId, currentTimestamp);

    // get ongoing orderId of driver to broadcast update
    pipeline.get(orderKey);

    try {
      const [
        updateLocationOfDriverResponse,
        updateDriverSetResponse,
        getOrderByDriverResponse,
      ] = await pipeline.exec();
      console.log({
        updateLocationOfDriverResponse,
        updateDriverSetResponse,
        getOrderByDriverResponse,
      });

      const [_, orderId] = getOrderByDriverResponse;
      if (orderId) {
        // broadcast location update
        this.sendOrderLocationUpdateEvent({
          driverId,
          orderId: orderId,
          latitude,
          longitude,
        });
      }
    } catch (e) {}
  }

  async updateDriverActiveStatus(
    updateDriverActiveStatusDto: UpdateDriverActiveStatusDto,
  ) {
    const {
      driverId,
      activeStatus,
      latitude,
      longitude,
    } = updateDriverActiveStatusDto;
    const activeKey = `driver:active`;

    const pipeline = this.redis.pipeline();
    try {
      if (activeStatus) {
        pipeline.sadd(activeKey, driverId);
        await this.updateDriverLocation({ driverId, latitude, longitude });
      } else {
        pipeline.srem(activeKey, driverId);
      }

      const results = await pipeline.exec();
      results.forEach(([error, response]) => {
        if (error) {
          throw 'Redis error';
        }
      });

      return {
        status: HttpStatus.OK,
        message: 'Update active status successfully',
      };
    } catch (e) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: e.message,
      };
    }
  }

  async getDriverActiveStatusService(driverId: string) {
    const activeKey = `driver:active`;
    return this.redis.sismember(activeKey, driverId);
  }

  async getDriverActiveStatus(
    getDriverActiveStatusDto: GetDriverActiveStatusDto,
  ) {
    try {
      const { driverId } = getDriverActiveStatusDto;
      const result = await this.getDriverActiveStatusService(driverId);
      return {
        status: HttpStatus.OK,
        message: 'Get active status successfully',
        data: {
          activeStatus: result,
        },
      };
    } catch (e) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: e.message,
      };
    }
  }
}
