export interface Point {
  latitude: number;
  longitude: number;
}
export function distanceMeters(a: Point, b: Point) {
  const radians = Math.PI / 180;
  const lat = (b.latitude - a.latitude) * radians,
    lon = (b.longitude - a.longitude) * radians;
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(a.latitude * radians) *
      Math.cos(b.latitude * radians) *
      Math.sin(lon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
