import { S2Cell, S2CellId, S2LatLng, S2RegionCoverer, Utils } from 'nodes2ts';
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

  static getGeoHashesNearLocation(
    location: Location,
    radius: number,
  ): string[] {
    const region = Utils.calcRegionFromCenterRadius(
      Location.toS2LatLong(location),
      radius,
      8,
    );

    const regionCoverer = new S2RegionCoverer();
    // regionCoverer.setMaxCells(10);
    regionCoverer.setMaxLevel(LEVEL);
    regionCoverer.setMinLevel(LEVEL);

    const cells = regionCoverer.getCoveringCells(region);
    const results = cells.map((r) => r.toToken());

    console.log(results.join(','));

    return results;
  }

  static degreeToRadian(deg: number): number {
    return deg * (Math.PI / 180);
  }

  static getDistanceFrom2Location(point1: Location, point2: Location): number {
    const R = 6371; // Radius of the earth in kilometers
    const dLat = Location.degreeToRadian(point2.latitude - point1.latitude); // Location.degreeToRadian below
    const dLon = Location.degreeToRadian(point2.longitude - point1.longitude);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(Location.degreeToRadian(point1.latitude)) *
        Math.cos(Location.degreeToRadian(point2.latitude)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c * 1000; // Distance in KM
    return Math.round(d / 100) * 100;
  }
}
