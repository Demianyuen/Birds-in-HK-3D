import { describe, expect, it } from 'vitest';
import { readGoogleMapsConfiguration } from '../src/integrations/GoogleMapsCsdiOverlay';

describe('Google Maps CSDI overlay configuration', () => {
  it('requires both the browser-restricted Maps key and a vector map ID', () => {
    expect(readGoogleMapsConfiguration({})).toBeNull();
    expect(readGoogleMapsConfiguration({ VITE_GOOGLE_MAPS_API_KEY: 'key' })).toBeNull();
    expect(readGoogleMapsConfiguration({ VITE_GOOGLE_MAP_ID: 'map-id' })).toBeNull();
  });

  it('trims and returns only the configuration needed by the browser loader', () => {
    expect(readGoogleMapsConfiguration({
      VITE_GOOGLE_MAPS_API_KEY: ' browser-key ',
      VITE_GOOGLE_MAP_ID: ' vector-map-id ',
    })).toEqual({ apiKey: 'browser-key', mapId: 'vector-map-id' });
  });
});
