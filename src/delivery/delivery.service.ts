import { Inject, Injectable, Logger } from "@nestjs/common";
import { NOTIFICATION_SERVICE, ORDER_SERVICE } from "src/constants";
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class DeliveryService {
  constructor(
    @Inject(NOTIFICATION_SERVICE)
    private notificationServiceClient: ClientProxy,
    @Inject(ORDER_SERVICE)
    private orderServiceClient: ClientProxy,
  ) {}

  private readonly logger = new Logger('DeliveryService');
}