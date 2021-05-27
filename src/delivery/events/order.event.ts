import { DeliveryStatus } from 'src/shared/enums/delivery-status.enum';
import { OrderStatus } from 'src/shared/enums/order-status.enum';

export class OrderEventPayload {
  id: string;
  cashierId: string;
  restaurantId: string;
  createdAt: Date;
  updatedAt: Date;
  status: OrderStatus;
  delivery: DeliveryPayload;
}

export class DeliveryPayload {
  customerId: string;
  driverId: string;
  customerAddress: string;
  customerGeom: { type: string; coordinates: number[] };
  restaurantAddress: string;
  restaurantGeom: { type: string; coordinates: number[] };
  distance: number;
  shippingFee: number;
  status: DeliveryStatus;
  createdAt: Date;
  updatedAt: Date;
}
