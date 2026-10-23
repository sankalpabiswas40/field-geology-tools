# Field Geology Tools

An offline field app for iPhone and iPad: a DEM hillshade map, GPS location, station recording,
a trace predictor and a stereonet. It works with no internet once it has been opened once.

**App:** https://sankalpabiswas40.github.io/field-geology-tools/

## Getting started
1. Open the link in Safari, then Share → **Add to Home Screen**. Always open it from that icon.
2. **Load DEM**: choose a Copernicus GLO-30 GeoTIFF (WGS84, EPSG:4326) from Files. It is remembered.
3. **My location** shows where you are and the DEM elevation (bilinear, never GPS height).

## Recording
- **New station**: the ID (D1-01, D1-02 …), time and GPS position fill in by themselves. Use
  **Place on map** if GPS is poor. Strike/dip use the right-hand rule (dip direction = strike + 90°).
  Lineations use trend/plunge. **Repeat last** copies feature type and lithology.
- Tap a station on the map to see it, **Edit**, **Delete** or **Predict trace**.

## Analysis
- **Predict trace** shows where the bed would meet the ground IF it were a flat plane. A mismatch
  in the field is evidence of folding or faulting.
- **Stereonet** tab: poles, fold axis, girdle, interlimb angles (two ways) with warnings when the
  data cannot support an answer.

## Keep your data safe
- Record on **one device only**.
- Every evening: **Export** (CSV, GeoJSON, KML) and **Backup** (one JSON file with everything),
  saved to Files. The DEM is not in the backup: keep the GeoTIFF too.
- **Restore** adds stations from a backup without duplicates.

See the **Help** tab in the app for more, and CHECKLIST.md for the tests to do before a trip.

## For developers
Plain HTML/CSS/JS modules, no build step. Run the tests with `node --test`. Project rules are in CLAUDE.md.
