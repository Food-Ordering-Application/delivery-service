import { Location } from '../dto';
export interface IGetLatestDriverLocationResponse {
  status: number;
  message: string;
  data: {
    location: Location;
  };
}
