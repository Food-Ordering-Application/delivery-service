import { Location } from '.';
import { OrderEventPayload } from '../events';

export class DeliveryDetailDto {
  orderId: string;
  restaurantLocation: Location;
  deliveryDistance: number;
  fee: {
    grandTotal: number;
    subTotal: number;
    shippingFee: number;
  };
  paymentMethod: 'COD' | 'PAYPAL' | 'CASH';

  static fromOrderPayload(order: OrderEventPayload): DeliveryDetailDto {
    const {
      id,
      delivery,
      subTotal,
      grandTotal,
      invoice: {
        payment: { method: paymentMethod },
      },
    } = order;

    const { restaurantGeom, distance, shippingFee } = delivery;

    const restaurantLocation = Location.GeometryToLocation(restaurantGeom);

    const deliveryDetail: DeliveryDetailDto = {
      orderId: id,
      restaurantLocation: restaurantLocation,
      deliveryDistance: distance,
      fee: {
        subTotal,
        grandTotal,
        shippingFee,
      },
      paymentMethod,
    };
    return deliveryDetail;
  }

  static toOrderPayload(deliveryDetail: DeliveryDetailDto): OrderEventPayload {
    const {
      deliveryDistance,
      fee: { grandTotal, subTotal, shippingFee },
      orderId,
      paymentMethod,
    } = deliveryDetail;
    return {
      id: orderId,
      delivery: {
        distance: deliveryDistance,
        shippingFee,
      },
      grandTotal,
      subTotal,
      invoice: {
        payment: {
          method: paymentMethod,
        },
      },
    };
  }
}
