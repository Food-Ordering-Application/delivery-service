import { S2Cell, S2CellId, S2LatLng } from 'nodes2ts';
const LEVEL = 12;
export class Location {
  latitude: number;
  longitude: number;
  static GeometryToLocation(geometry: {
    type: string;
    coordinates: number[];
  }): Location {
    const { type, coordinates = [] } = geometry;
    if (
      type != 'Point' ||
      !Array.isArray(coordinates) ||
      coordinates.length < 2
    )
      return null;

    const latitude = coordinates[1];
    const longitude = coordinates[0];
    return {
      latitude,
      longitude,
    };
  }

  static LocationToGeometry(
    position: Location,
  ): {
    type: 'Point';
    coordinates: number[];
  } {
    const { latitude, longitude } = position;
    return {
      type: 'Point',
      coordinates: [longitude, latitude],
    };
  }

  static validLocation(position: Location): boolean {
    if (!position) return false;
    const { latitude, longitude } = position || {};
    if (latitude === undefined || longitude === undefined) {
      return false;
    }
    return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  }

  static toGeoHash(location: Location): string {
    return Location.toS2CellId(location).toToken();
  }

  static toS2CellId(location: Location): S2CellId {
    return Location.toS2Cell(location).id.parentL(LEVEL);
  }

  static toS2Cell(location: Location): S2Cell {
    return S2Cell.fromPoint(Location.toS2LatLong(location).toPoint());
  }

  static toS2LatLong({ latitude, longitude }: Location): S2LatLng {
    return S2LatLng.fromDegrees(latitude, longitude);
  }
}
