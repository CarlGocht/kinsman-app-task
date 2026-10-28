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
