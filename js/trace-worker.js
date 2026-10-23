// Runs the trace prediction in the background, so the screen stays responsive
// while a big DEM is being processed.
import { predictTraces } from './geo/trace.js';

self.onmessage = (event) => {
  const { id, grid, elevation, station, attitudes } = event.data;
  let result;
  try {
    result = predictTraces(grid, elevation, station, attitudes);
  } catch (e) {
    result = { ok: false, message: e.message };
  }
  self.postMessage({ id, result });
};
