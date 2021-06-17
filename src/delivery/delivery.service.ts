import { IUpdateDriverActiveStatusResponse } from './interfaces/update-driver-active-status-response.interface';
import { ICheckDriverAccountBalanceResponse as ICheckDriverAccountBalanceResponse } from './interfaces/check-driver-account-balance-response.interface';
import {
  UpdateDriverLocationDto,
  Location,
  UpdateDriverActiveStatusDto,
  GetDriverActiveStatusDto,
  DeliveryDetailDto,
} from './dto/';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  NOTIFICATION_SERVICE,
  ORDER_SERVICE,
  USER_SERVICE,
} from 'src/constants';
import { ClientProxy } from '@nestjs/microservices';
import { DriverAcceptOrderDto } from './dto';
import {
  IDriverAcceptOrderResponse,
  IDriverLocation,
  IDriverWithEAT,
  IGetDriverActiveStatusResponse,
} from './interfaces';
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
    // TODO: clear order data
    // TODO: apply acceptance rate
    this.sendUpdateDriverForOrderEvent({ driverId, orderId });

    return {
      status: HttpStatus.OK,
      message: 'Accept order successfully',
    };
  }

  async handleDispatchDriver(order: OrderEventPayload) {
    const { id: orderId, delivery } = order;
    const { restaurantGeom } = delivery;
    const restaurantLocation = Location.GeometryToLocation(restaurantGeom);

    const RADIUS = 3;
    const driverRawListByOrderSetName = `driver:order:${orderId}:raw_list`;

    // save order to reduce retrieve data time
    const deliveryDetail = await this.saveDeliveryDetailOfOrder(order);

    // find all nearby drivers
    await this.setDriverListForLocation(
      restaurantLocation,
      RADIUS,
      driverRawListByOrderSetName,
    );

    const driverListByOrderQueueName = `driver:order:${orderId}:list`;

    // initial best driver queue
    await this.initialDriverQueueByOrder(
      orderId,
      RADIUS,
      driverRawListByOrderSetName,
      driverListByOrderQueueName,
      deliveryDetail,
    );

    // start to dispatch driver
    while (true) {
      const result = await this.dispatchDriverByOrderId(
        orderId,
        deliveryDetail,
      );
      if (result) {
        break;
      }
      this.logger.log(`try to dispatch order ${orderId} to another driver`);
      const popSuccess = this.popFirstDriverOfOrderQueue(orderId);
      // can pop => queue is empty
      if (!popSuccess) {
        break;
      }
    }
  }

  async saveDeliveryDetailOfOrder(
    order: OrderEventPayload,
  ): Promise<DeliveryDetailDto> {
    const { id } = order;
    const restaurantLocationOfOrderKey = `order:${id}:delivery_detail`;
    const deliveryDetail: DeliveryDetailDto = DeliveryDetailDto.fromOrderPayload(
      order,
    );

    await this.redis.set(
      restaurantLocationOfOrderKey,
      JSON.stringify(deliveryDetail),
    );
    return deliveryDetail;
  }

  async getDeliveryDetailOfOrder(orderId: string): Promise<DeliveryDetailDto> {
    const restaurantLocationOfOrderKey = `order:${orderId}:delivery_detail`;

    const rawRestaurantLocation = await this.redis.get(
      restaurantLocationOfOrderKey,
    );

    const deliveryDetail = JSON.parse(
      rawRestaurantLocation,
    ) as DeliveryDetailDto;

    return deliveryDetail;
  }

  async setDriverListForLocation(
    location: Location,
    radius: number,
    setName: string,
  ) {
    const pipeline = this.redis.pipeline();

    // get all keys
    const hashKeys = Location.getGeoHashesNearLocation(location, radius);

    // delete all expired data of result keys
    const currentTimestamp = Date.now();

    hashKeys.forEach((geoHash) => {
      const geoKey = geoHash;
      // delete expired data before retrieve
      pipeline.zremrangebyscore(
        geoKey,
        -Infinity,
        currentTimestamp - 30 * 1000,
      );
    });

    await pipeline.exec();

    // retrieve all driverId by keys

    // merge driver set by result geo hash
    const remainHashKeys = [...hashKeys.slice(1)];
    pipeline.zunionstore(
      setName,
      hashKeys.length,
      hashKeys[0],
      ...remainHashKeys,
    );

    const result = await pipeline.exec();
  }

  async initialDriverQueueByOrder(
    orderId: string,
    radius: number,
    setName: string,
    queueName: string,
    deliveryDetail: DeliveryDetailDto,
  ) {
    const driverIds = await this.getDriverIdsOfOrder(setName);

    // filter drivers

    // populate driver location
    const driversLocationList = await this.populateDriverLocationByIds(
      driverIds,
    );

    // get delivery detail

    const { deliveryDistance, restaurantLocation } = deliveryDetail;

    // calculate EAT
    const driverWithEATList: IDriverWithEAT[] = driversLocationList.reduce(
      (prev, { driverId, location: driverLocation }) => {
        const pickUpDistance = Location.getDistanceFrom2Location(
          driverLocation,
          restaurantLocation,
        );
        if (pickUpDistance > radius * 1000) {
          return prev;
        }
        // thoi gian giao hang du kien = max(thoi gian chuan bi, thoi gian shipper toi cua hang) +
        // thoi gian di chuyen cua shipper (average_time_per_1km * distance)
        const DEFAULT_RESTAURANT_PREPARATION_TIME = 15;
        const AVG_TIME_PER_1KM = 10;

        const pickUpTime = Math.round(
          Math.max(
            DEFAULT_RESTAURANT_PREPARATION_TIME,
            (pickUpDistance * AVG_TIME_PER_1KM) / 1000,
          ),
        );
        const estimatedArrivalTime =
          pickUpTime + (deliveryDistance * AVG_TIME_PER_1KM) / 1000;

        const totalDistance = deliveryDistance + pickUpDistance;

        const newDriverWithEAT: IDriverWithEAT = {
          driverId,
          totalDistance,
          estimatedArrivalTime,
        };
        prev.push(newDriverWithEAT);
        return prev;
      },
      [] as IDriverWithEAT[],
    );

    // sort drivers
    const scoreAndDrivers: (string | number)[] = driverWithEATList.reduce(
      (prev, driver) => {
        prev.push(driver.estimatedArrivalTime);
        prev.push(JSON.stringify(driver));
        return prev;
      },
      [] as (string | number)[],
    );
    const pipeline = this.redis.pipeline();
    pipeline.zadd(queueName, ...scoreAndDrivers);
    const result = await pipeline.exec();
  }

  async dispatchDriverByOrderId(
    orderId: string,
    deliveryDetail: DeliveryDetailDto,
  ): Promise<boolean> {
    const driver = await this.getNextDriverOfOrderQueue(orderId);
    if (!driver) {
      this.logger.log(
        `There is no driver available nearby restaurant location`,
      );
      // TODO: handle looking for new active driver
      return true;
    }
    const { driverId, estimatedArrivalTime, totalDistance } = driver;
    this.logger.log(`try to dispatch order ${orderId} to driver ${driverId}`);
    // validate driver to be dispatchable

    // is active
    const isActive = await this.getDriverActiveStatusService(driverId);
    if (!isActive) {
      this.logger.log(`driver ${driverId} is no longer active`);
      return false;
    }

    // is available
    const isAvailable = await this.getDriverAvailableStatusService(driverId);
    if (!isAvailable) {
      this.logger.log(
        `driver ${driverId} is not available (already accepted or requested)`,
      );
      return false;
    }

    // can handle order
    const response: ICheckDriverAccountBalanceResponse = await this.userServiceClient
      .send('checkDriverAccountBalance', {
        order: DeliveryDetailDto.toOrderPayload(deliveryDetail),
        driverId: driverId,
      })
      .toPromise();
    const { canAccept, message } = response;
    if (!canAccept) {
      this.logger.log(
        `driver ${driverId} doesnt have enough balance to handle order, ${message}`,
      );
      return false;
    }

    // dispatch driver

    // TODO: apply acceptance rate
    this.sendDispatchDriverEvent({
      orderId: orderId,
      driverId: driverId,
      estimatedArrivalTime,
      totalDistance,
    });

    // TODO: add delay task to auto decline
    // TODO: handle decline
    // TODO: decline -> remove -> reduce acceptance rate -> remove relate data -> try dispatch another driver
    return true;
  }

  // TODO: handle order complete -> remove relate data

  async getNextDriverOfOrderQueue(orderId: string): Promise<IDriverWithEAT> {
    const driverListByOrderQueueName = `driver:order:${orderId}:list`;
    const driver = await this.redis.zrange(driverListByOrderQueueName, 0, 0);
    if (!Array.isArray(driver) || !driver.length) {
      return null;
    }
    const driverWithEAT: IDriverWithEAT = JSON.parse(driver[0]);
    return driverWithEAT;
  }

  async popFirstDriverOfOrderQueue(orderId: string): Promise<boolean> {
    const driverListByOrderQueueName = `driver:order:${orderId}:list`;
    const result = await this.redis.zremrangebyrank(
      driverListByOrderQueueName,
      0,
      0,
    );
    return result > 0;
  }

  async getDriverIdsOfOrder(setName: string): Promise<string[]> {
    const pipeline = this.redis.pipeline();
    // retrieve driver ids
    pipeline.zrange(setName, 0, -1);

    const responses = await pipeline.exec();

    const [driverIdsSetResponse] = responses;
    const [driverIdsSetError, driverIds] = driverIdsSetResponse as [
      Error,
      string[],
    ];
    return driverIds;
  }

  async populateDriverLocationByIds(
    driverIds: string[],
  ): Promise<IDriverLocation[]> {
    const pipeline = this.redis.pipeline();
    // retrieve all driver by driverId
    const getPreciseLocationKey = (driverId) => `driver:${driverId}:location`;
    driverIds.forEach((driverId) => {
      pipeline.get(getPreciseLocationKey(driverId));
    });

    const driverLocationResponse: [Error, string][] = await pipeline.exec();
    const results: IDriverLocation[] = driverLocationResponse.map(
      ([error, location], index) => {
        return {
          driverId: driverIds[index],
          location: JSON.parse(location) as Location,
        };
      },
    );
    return results;
  }

  async populateDriverLocationById(driverId: string): Promise<IDriverLocation> {
    const getPreciseLocationKey = (driverId) => `driver:${driverId}:location`;
    const location = await this.redis.get(getPreciseLocationKey(driverId));
    return {
      driverId,
      location: JSON.parse(location) as Location,
    };
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

    const isDriverActive = await this.getDriverActiveStatusService(driverId);

    const pipeline = this.redis.pipeline();

    // update location
    pipeline.set(preciseLocationKey, jsonLocation);

    if (isDriverActive) {
      // update driver set by location
      pipeline.zadd(geoKey, currentTimestamp, driverId);
      pipeline.zremrangebyscore(
        geoKey,
        -Infinity,
        currentTimestamp - 30 * 1000,
      );

      // get ongoing orderId of driver to broadcast update
      pipeline.get(orderKey);
    }

    try {
      const pipelineResponse = await pipeline.exec();
      if (!isDriverActive) {
        return;
      }
      const [
        updateLocationOfDriverResponse,
        updateDriverSetResponse,
        removeExpiredDriverSetResponse,
        getOrderByDriverResponse,
      ] = pipelineResponse;

      console.log({
        updateLocationOfDriverResponse,
        updateDriverSetResponse,
        removeExpiredDriverSetResponse,
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
      // TODO: check if it is a new driver (is not exist in order queue) and this geo hash is subscribe by some order

      // TODO: add driver to order queue
      // if dispatch is stopped => try to dispatch
    } catch (e) {}
  }

  async updateDriverActiveStatus(
    updateDriverActiveStatusDto: UpdateDriverActiveStatusDto,
  ): Promise<IUpdateDriverActiveStatusResponse> {
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

  async getDriverActiveStatusService(driverId: string): Promise<boolean> {
    const activeKey = `driver:active`;
    const result = await this.redis.sismember(activeKey, driverId);
    return result == 1;
  }

  async getDriverAvailableStatusService(driverId: string): Promise<boolean> {
    const orderKey = `driver:${driverId}:order`;
    const result = await this.redis.get(orderKey);

    // TODO: check if driver has been requested
    return !result;
  }

  async getDriverActiveStatus(
    getDriverActiveStatusDto: GetDriverActiveStatusDto,
  ): Promise<IGetDriverActiveStatusResponse> {
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
