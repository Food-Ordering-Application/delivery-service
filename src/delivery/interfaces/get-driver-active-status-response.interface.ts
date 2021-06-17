export interface IGetDriverActiveStatusResponse {
  status: number;
  message: string;
  data?: {
    activeStatus: boolean;
  };
}
