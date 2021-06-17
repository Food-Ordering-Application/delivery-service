import { InjectRedis, Redis } from '@nestjs-modules/ioredis';
import { InjectQueue } from '@nestjs/bull';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Queue } from 'bull';
import {
  DISPATCHER_QUEUE,
  NOTIFICATION_SERVICE,
  ORDER_SERVICE,
  USER_SERVICE,
} from 'src/constants';
import { DriverAcceptOrderDto } from './dto';
import {
  DeliveryDetailDto,
  DriverDeclineOrderDto,
  GetDriverActiveStatusDto,
  Location,
  UpdateDriverActiveStatusDto,
  UpdateDriverLocationDto,
} from './dto/';
import { GetLatestDriverLocationDto } from './dto/get-latest-driver-location.dto';
import {
  DispatchDriverEventPayload,
  OrderEventPayload,
  OrderLocationUpdateEventPayload,
  UpdateDriverForOrderEventPayload,
} from './events';
import {
  IDriverAcceptOrderResponse,
  IDriverDeclineOrderResponse,
  IDriverLocation,
  IDriverWithEAT,
  IGetDriverActiveStatusResponse,
  IGetLatestDriverLocationResponse,
} from './interfaces';
import { ICheckDriverAccountBalanceResponse as ICheckDriverAccountBalanceResponse } from './interfaces/check-driver-account-balance-response.interface';
import { IUpdateDriverActiveStatusResponse } from './interfaces/update-driver-active-status-response.interface';

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

    @InjectQueue(DISPATCHER_QUEUE)
    private dispatcherQueue: Queue,
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

    // check driverId with id of dispatcher
    const currentOrder = await this.getCurrentOrderOfDriver(driverId);
    if (!currentOrder) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Order request is expired',
      };
    }

    if (orderId !== currentOrder) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message:
          'Cannot accept this order. You have already had another order to handle',
      };
    }

    // accept success
    this.logger.log(`Driver ${driverId} accepted, remove timeout job`);
    await this.removeTimeoutDeclineJob(acceptOrderDto);

    // clear order data
    this.clearOrderData(orderId);

    // TICKET: store order of driver
    // TICKET: apply acceptance rate
    this.sendUpdateDriverForOrderEvent({ driverId, orderId });

    return {
      status: HttpStatus.OK,
      message: 'Accept order successfully',
    };
  }

  // handle decline
  async declineOrder(
    declineOrderDto: DriverDeclineOrderDto,
    isAuto = false,
  ): Promise<IDriverDeclineOrderResponse> {
    const { driverId, orderId } = declineOrderDto;
    this.logger.log(
      `Order ${orderId} request has been decline by driver ${driverId}`,
    );
    const currentOrder = await this.getCurrentOrderOfDriver(driverId);
    if (!currentOrder) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Order request is expired',
      };
    }

    if (orderId !== currentOrder) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message:
          'You cannot decline this order. This is not your assigned order',
      };
    }

    // remove relate data (order request)
    await this.clearCurrentOrderOfDriver(driverId);

    if (!isAuto) {
      this.logger.log(`Driver ${driverId} declined, remove timeout job`);
      await this.removeTimeoutDeclineJob(declineOrderDto);
    }
    // TICKET: reduce acceptance rate
    // decline -> remove
    const isNotEmpty = await this.popFirstDriverOfOrderQueue(orderId);
    if (isNotEmpty) {
      // try dispatch another driver
      this.tryDispatchOrderForAnotherDriver(orderId);
    }

    return {
      status: HttpStatus.OK,
      message: 'Decline order successfully',
    };
  }

  async removeTimeoutDeclineJob(declineOrderDto: DriverDeclineOrderDto) {
    const { driverId, orderId } = declineOrderDto;
    const jobId = `${driverId}-decline-${orderId}`;
    const job = await this.dispatcherQueue.getJob(jobId);
    await job.remove();
  }

  async clearOrderData(orderId: string) {
    const driverListByOrderQueueName = `order:${orderId}:list`;
    const driverRawListByOrderSetName = `order:${orderId}:raw_list`;
    const deliveryDetailKey = `order:${orderId}:delivery_detail`;
    const orderSubscribeCurrentGeoHash = `order:${orderId}:geoHash`;

    const pipeline = this.redis.pipeline();
    // remove raw list
    pipeline.del(driverListByOrderQueueName);
    // remove dispatch list
    pipeline.del(driverRawListByOrderSetName);
    // remove order detail
    pipeline.del(deliveryDetailKey);

    // get all geohash before remove
    pipeline.smembers(orderSubscribeCurrentGeoHash);
    pipeline.del(orderSubscribeCurrentGeoHash);

    let result = await pipeline.exec();
    const [_1, _2, _3, geoHashListResponse, _4] = result;

    const [error, geoHashList] = geoHashListResponse as [Error, string[]];

    if (Array.isArray(geoHashList)) {
      geoHashList.forEach((geoHash) => {
        const ordersSubscribeCurrentGeoHash = `${geoHash}:subscribers`;
        // remove current order from subscriber list
        pipeline.srem(ordersSubscribeCurrentGeoHash, orderId);
      });
    }

    result = await pipeline.exec();
  }

  async handleDispatchDriver(order: OrderEventPayload) {
    const { id: orderId, delivery } = order;
    const { restaurantGeom } = delivery;
    const restaurantLocation = Location.GeometryToLocation(restaurantGeom);

    const RADIUS = 3;
    const driverRawListByOrderSetName = `order:${orderId}:raw_list`;

    // save order to reduce retrieve data time
    const deliveryDetail = await this.saveDeliveryDetailOfOrder(order);

    // find all nearby drivers
    await this.setDriverListForLocation(
      restaurantLocation,
      RADIUS,
      driverRawListByOrderSetName,
      orderId,
    );

    const driverListByOrderQueueName = `order:${orderId}:list`;

    // initial best driver queue
    await this.initialDriverQueueByOrder(
      orderId,
      RADIUS,
      driverRawListByOrderSetName,
      driverListByOrderQueueName,
      deliveryDetail,
    );

    // start to dispatch driver
    await this.startDispatchOrder(orderId, deliveryDetail);
  }

  async handleDriverCompleteOrder(order: OrderEventPayload) {
    // handle order complete
    // TODO?: remove relate data
    const { delivery } = order;
    const { driverId } = delivery;
    this.logger.log(`${driverId} finished an order`);
    await this.clearCurrentOrderOfDriver(driverId);
  }

  async tryDispatchOrderForAnotherDriver(orderId: string) {
    const deliveryDetail = await this.getDeliveryDetailOfOrder(orderId);
    this.startDispatchOrder(orderId, deliveryDetail);
  }

  async startDispatchOrder(orderId: string, deliveryDetail: DeliveryDetailDto) {
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
    const deliveryDetailKey = `order:${orderId}:delivery_detail`;

    const rawRestaurantLocation = await this.redis.get(deliveryDetailKey);

    const deliveryDetail = JSON.parse(
      rawRestaurantLocation,
    ) as DeliveryDetailDto;

    return deliveryDetail;
  }

  async setDriverListForLocation(
    location: Location,
    radius: number,
    setName: string,
    orderId: string,
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
        currentTimestamp - 60 * 1000,
      );

      // add subscribe to geo current geo hash
      // => update geo hash => broadcast change and try to dispatch order
      const ordersSubscribeCurrentGeoHash = `${geoKey}:subscribers`;
      pipeline.sadd(ordersSubscribeCurrentGeoHash, orderId);
    });

    // save geo hash result to order
    // => retrieve geo hash by order => remove subscribe
    const geoHashOfOrder = `order:${orderId}:geoHash`;
    pipeline.sadd(geoHashOfOrder, hashKeys);

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
    // remove non active driver by get driver by geo hash

    // TICKET: remove non available driver

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
        // TICKET: disable radius check, use raw list as driver list
        // if (pickUpDistance > radius * 1000) {
        //   return prev;
        // }
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

    // TICKET: separate order request with order handling of driver
    const orderKey = `driver:${driverId}:order`;
    const result = await this.redis.set(orderKey, orderId);
    // TICKET: apply acceptance rate
    this.sendDispatchDriverEvent({
      orderId: orderId,
      driverId: driverId,
      estimatedArrivalTime,
      totalDistance,
    });

    const payload: DriverDeclineOrderDto = { driverId, orderId };
    await this.dispatcherQueue.add('timeoutDecline', payload, {
      delay: 60 * 1000,
      jobId: `${driverId}-decline-${orderId}`,
    });
    return true;
  }

  async getNextDriverOfOrderQueue(orderId: string): Promise<IDriverWithEAT> {
    const driverListByOrderQueueName = `order:${orderId}:list`;
    const driver = await this.redis.zrange(driverListByOrderQueueName, 0, 0);
    if (!Array.isArray(driver) || !driver.length) {
      this.logger.log(
        `There is no remain driver available nearby restaurant location to handle order ${orderId}`,
      );
      return null;
    }
    const driverWithEAT: IDriverWithEAT = JSON.parse(driver[0]);
    return driverWithEAT;
  }

  async popFirstDriverOfOrderQueue(orderId: string): Promise<boolean> {
    const driverListByOrderQueueName = `order:${orderId}:list`;
    const result = await this.redis.zremrangebyrank(
      driverListByOrderQueueName,
      0,
      0,
    );
    if (result == 0) {
      this.logger.log(
        `There is no remain driver available nearby restaurant location to handle order ${orderId}`,
      );
    }
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
    if (!location) {
      return null;
    }
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
        currentTimestamp - 60 * 1000,
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

      // console.log({
      //   updateLocationOfDriverResponse,
      //   updateDriverSetResponse,
      //   removeExpiredDriverSetResponse,
      //   getOrderByDriverResponse,
      // });

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
      } else {
        pipeline.srem(activeKey, driverId);
      }

      const results = await pipeline.exec();
      results.forEach(([error, response]) => {
        if (error) {
          throw 'Redis error';
        }
      });

      if (activeStatus) {
        await this.updateDriverLocation({ driverId, latitude, longitude });
      }

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

  async getLatestLocationOfDriver(
    getLatestDriverLocationDto: GetLatestDriverLocationDto,
  ): Promise<IGetLatestDriverLocationResponse> {
    const { driverId } = getLatestDriverLocationDto;
    try {
      const driverLocation = await this.populateDriverLocationById(driverId);
      if (!driverLocation) {
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Driver location not found',
          data: null,
        };
      }
      const { location } = driverLocation;
      return {
        status: HttpStatus.OK,
        message: 'Get latest location of driver successfully',
        data: {
          location,
        },
      };
    } catch (e) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: e.message,
        data: null,
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

    // check if driver has been requested
    // TICKET: separate order request with order handling of driver
    return !result;
  }

  async getCurrentOrderOfDriver(driverId: string): Promise<string> {
    const orderKey = `driver:${driverId}:order`;
    const result = await this.redis.get(orderKey);
    return result ? result : null;
  }

  async clearCurrentOrderOfDriver(driverId: string): Promise<boolean> {
    const orderKey = `driver:${driverId}:order`;
    const result = await this.redis.del(orderKey);
    return result > 0;
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
