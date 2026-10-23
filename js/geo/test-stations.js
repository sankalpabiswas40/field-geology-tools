// Built-in TEST DATA: 10 stations around the centre of the loaded DEM, describing a fold with a
// known answer (fold axis 040/15, interlimb angle about 80°), so the app can be checked.
// Pure functions only: no browser code.

import { toUtm, fromUtm, utmZone } from './utm.js';
import { elevationAt } from './raster.js';
import { dipDirectionFromStrike } from './attitude.js';

const DEG = Math.PI / 180;

/** Fold-aligned frame: "along" runs towards 040°, "across" towards 130° (SE). */
export const ALONG_AZIMUTH = 40;
export const ACROSS_AZIMUTH = 130;

/** The 10 test stations. Strike/dip use the right-hand rule; along/across in metres. */
export const TEST_STATIONS = [
  { stationId: 'S01', featureType: 'bedding', strike: 232, dip: 52, along: 0, across: -600 },
  { stationId: 'S02', featureType: 'bedding', strike: 237, dip: 42, along: 300, across: -450 },
  { stationId: 'S03', featureType: 'bedding', strike: 244, dip: 33, along: 0, across: -300 },
  { stationId: 'S04', featureType: 'bedding', strike: 255, dip: 25, along: -300, across: -150 },
  { stationId: 'S05', featureType: 'bedding', strike: 5, dip: 25, along: 0, across: 150 },
  { stationId: 'S06', featureType: 'bedding', strike: 16, dip: 33, along: 300, across: 300 },
  { stationId: 'S07', featureType: 'bedding', strike: 23, dip: 42, along: 0, across: 450 },
  { stationId: 'S08', featureType: 'bedding', strike: 28, dip: 52, along: -300, across: 600 },
  { stationId: 'S09', featureType: 'other', strike: 0, dip: 0, along: 0, across: 0 },
  { stationId: 'S10', featureType: 'other', strike: 40, dip: 90, along: 150, across: 0 },
];

/**
 * East/north offsets in metres from along/across distances:
 *   E = along·sin(40°) + across·sin(130°)
 *   N = along·cos(40°) + across·cos(130°)
 */
export function frameToEastNorth(along, across) {
  return {
    east: along * Math.sin(ALONG_AZIMUTH * DEG) + across * Math.sin(ACROSS_AZIMUTH * DEG),
    north: along * Math.cos(ALONG_AZIMUTH * DEG) + across * Math.cos(ACROSS_AZIMUTH * DEG),
  };
}

/**
 * Places the test stations around the centre of a DEM.
 * Positions are worked out in UTM metres (zone of the DEM centre), converted back to WGS84,
 * and given a DEM elevation by bilinear interpolation.
 * Returns { centre, stations: [...], problems: [{ stationId, message }] }. A station whose
 * position is outside the DEM or on missing data is listed in `problems`, not in `stations`.
 */
export function placeTestStations(grid, elevation) {
  const centre = { lat: (grid.north + grid.south) / 2, lon: (grid.west + grid.east) / 2 };
  const zone = utmZone(centre.lat, centre.lon);
  const c = toUtm(centre.lat, centre.lon, zone);
  const stations = [];
  const problems = [];
  for (const t of TEST_STATIONS) {
    const off = frameToEastNorth(t.along, t.across);
    const { lat, lon } = fromUtm(c.easting + off.east, c.northing + off.north, zone, c.hemisphere);
    const here = elevationAt(grid, elevation, lat, lon);
    if (!here.ok) {
      problems.push({ stationId: t.stationId, message: `${t.stationId} not added: ${here.message}` });
      continue;
    }
    stations.push({
      stationId: t.stationId,
      latitude: lat,
      longitude: lon,
      accuracy: null,
      featureType: t.featureType,
      strike: t.strike,
      dip: t.dip,
      dipDirection: dipDirectionFromStrike(t.strike),
      younging: 'unknown',
      lithology: 'test',
      notes: 'TEST DATA',
      elevation: here.elevation,
      isTest: true,
    });
  }
  return { centre, stations, problems };
}
