// Great-circle displacement on a spherical Earth. Heading is clockwise from north.
export function destination(latitude: number, longitude: number, headingDegrees: number, meters: number) {
  const distance = meters / 6371008.8;
  const bearing = headingDegrees * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const lon = longitude * Math.PI / 180;
  const nextLat = Math.asin(Math.sin(lat) * Math.cos(distance) + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing));
  const nextLon = lon + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat), Math.cos(distance) - Math.sin(lat) * Math.sin(nextLat));
  return { latitude: nextLat * 180 / Math.PI, longitude: ((nextLon * 180 / Math.PI + 540) % 360) - 180 };
}

export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = Math.PI / 180;
  const lat1 = a.latitude * radians, lat2 = b.latitude * radians;
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((b.longitude - a.longitude) * radians / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
