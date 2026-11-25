import type { StationArrival } from '../types/transit';
import { formatShortStationLabel, normalizeSearchText } from './transitMath';

export interface StationDirectionGroup {
  key: string;
  routeId: string;
  routeShortName: string;
  routeColor: string;
  routeTextColor: string;
  routeType: number;
  directionId: number;
  headsign: string;
  displayHeadsign: string;
  nextArrivalTime: number;
  arrivals: StationArrival[];
}

/**
 * Groups upcoming station departures by (routeId + normalized headsign) so riders can
 * instantly distinguish opposing directions (e.g. Tram A -> Les Vergnes vs La Pardieu Gare).
 */
export function groupStationArrivalsByDirection(
  arrivals: readonly StationArrival[]
): StationDirectionGroup[] {
  const byKey = new Map<string, StationDirectionGroup>();

  for (const arrival of arrivals) {
    const displayHeadsign = formatShortStationLabel(arrival.headsign);
    const normHeadsign = normalizeSearchText(displayHeadsign);
    const key = `${arrival.routeId}::${normHeadsign || arrival.directionId}`;

    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        routeId: arrival.routeId,
        routeShortName: arrival.routeShortName,
        routeColor: arrival.routeColor,
        routeTextColor: arrival.routeTextColor,
        routeType: arrival.routeType,
        directionId: arrival.directionId,
        headsign: arrival.headsign,
        displayHeadsign,
        nextArrivalTime: arrival.arrivalTime,
        arrivals: [],
      };
      byKey.set(key, group);
    }

    group.arrivals.push(arrival);
    if (arrival.arrivalTime < group.nextArrivalTime) {
      group.nextArrivalTime = arrival.arrivalTime;
    }
  }

  const groups = Array.from(byKey.values());
  for (const g of groups) {
    g.arrivals.sort((a, b) => a.arrivalTime - b.arrivalTime);
    g.nextArrivalTime = g.arrivals[0]?.arrivalTime ?? g.nextArrivalTime;
  }

  groups.sort(
    (a, b) =>
      a.nextArrivalTime - b.nextArrivalTime ||
      a.routeShortName.localeCompare(b.routeShortName, 'fr') ||
      a.displayHeadsign.localeCompare(b.displayHeadsign, 'fr')
  );

  return groups;
}
