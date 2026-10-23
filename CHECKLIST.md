# Before the trip: test by hand, outside, in Airplane Mode

Do this on the ONE device you will record on.

## At home, with internet
- [ ] Open the app from the home-screen icon. Close it fully and open it again (this loads the latest version).
- [ ] Load your real DEM. Check the hillshade looks right and "DEM details" shows the expected area.
- [ ] Help tab opens and reads correctly.

## Outside, Airplane Mode ON
- [ ] Close the app fully, then open it from the home-screen icon: the map, DEM and stations appear.
- [ ] My location: the blue dot appears; accuracy drops to about ±5–10 m; DEM elevation is shown.
- [ ] New station with GPS: save it. Check the dip-direction arrow matches the real dip.
- [ ] New station with "Place on map": dashed ring on the map.
- [ ] A contact, a lineation and an "other" station save correctly.
- [ ] Bad input is refused: dip 95, strike 400, letters, empty location.
- [ ] Predict trace from a station: lines appear; Clear traces works.
- [ ] Stereonet: load test stations, tick "Include test stations": fold axis 040/15, interlimb 79° and 110°. Then "Delete all test stations".
- [ ] Export: the share sheet opens; "Save to Files" works for CSV, GeoJSON and KML. Open the CSV in Files to check it.
- [ ] Backup: the share sheet opens; save the JSON in Files.
- [ ] Turn the device off and on again: all stations are still there.
- [ ] Battery: note how much one hour of use with GPS on costs.

## Back home, with internet
- [ ] Restore the backup on a SECOND device (to practise): stations appear, and nothing is duplicated if you restore twice. Then delete that copy, so you record on one device only.
