export interface IGetDriverActiveStatus {
  status: number;
  message: string;
  data?: {
    activeStatus: boolean;
  };
}
