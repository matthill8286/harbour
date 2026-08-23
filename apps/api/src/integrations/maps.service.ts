import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MapConfig } from '@vip/shared';

@Injectable()
export class MapsService {
  constructor(private readonly config: ConfigService) {}

  getConfig(): MapConfig {
    const provider = this.config.get<string>('MAPS_PROVIDER', 'osm');
    if (provider === 'mapbox') {
      const token = this.config.get<string>('MAPBOX_TOKEN', '');
      return {
        provider: 'mapbox',
        tileUrl: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${token}`,
        attribution: '© Mapbox © OpenStreetMap',
        maxZoom: 18,
      };
    }
    return {
      provider: 'osm',
      tileUrl: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      attribution: '© OpenStreetMap © CARTO',
      maxZoom: 19,
    };
  }
}
