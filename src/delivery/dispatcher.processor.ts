import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { DISPATCHER_QUEUE } from 'src/constants';
import { DeliveryService } from './delivery.service';
import { DriverDeclineOrderDto } from './dto';

@Processor(DISPATCHER_QUEUE)
export class DispatcherProcessor {
  private readonly logger = new Logger(DISPATCHER_QUEUE);

  constructor(private readonly deliveryService: DeliveryService) {}

  @Process('timeoutDecline')
  async handleTimeoutDecline(job: Job<DriverDeclineOrderDto>) {
    const { data } = job;
    const { orderId, driverId } = data;
    this.logger.log(`timeoutDecline: ${driverId}-${orderId}`);
    const result = await this.deliveryService.declineOrder(data, true);
    this.logger.log(result);
    return;
  }

  @Process('dispatchNewDriver')
  async handleDispatchNewDriver(job: Job<string>) {
    const { data } = job;
    const orderId = data;
    this.logger.log(`dispatchNewDriver: ${orderId}`);
    const result = await this.deliveryService.tryDispatchOrderForAnotherDriver(
      orderId,
    );
    // this.logger.log(result);
    return;
  }
}
