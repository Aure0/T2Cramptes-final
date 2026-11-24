/**
 * Lightweight, zero-dependency Protocol Buffers wire decoder for GTFS-RT FeedMessage.
 * Enables 100% browser-native decoding of official T2C GTFS-RT TripUpdate feeds on
 * static hosts like GitHub Pages without bundling protobufjs.
 *
 * Field numbers follow the official GTFS-Realtime proto2 specification:
 * https://gtfs.org/documentation/realtime/proto/
 */

export interface DecodedStopTimeEvent {
  delay?: number;
  time?: number;
}

export interface DecodedStopTimeUpdate {
  stopSequence?: number;
  stopId?: string;
  arrival?: DecodedStopTimeEvent;
  departure?: DecodedStopTimeEvent;
}

export interface DecodedTripDescriptor {
  tripId?: string;
  routeId?: string;
  directionId?: number;
}

export interface DecodedVehicleDescriptor {
  id?: string;
  label?: string;
}

export interface DecodedTripUpdate {
  trip?: DecodedTripDescriptor;
  vehicle?: DecodedVehicleDescriptor;
  stopTimeUpdate: DecodedStopTimeUpdate[];
}

export interface DecodedFeedEntity {
  id: string;
  tripUpdate?: DecodedTripUpdate;
}

export interface DecodedFeedMessage {
  header: {
    gtfsRealtimeVersion?: string;
    timestamp?: number;
  };
  entity: DecodedFeedEntity[];
}

const textDecoder = new TextDecoder('utf-8');

class ProtoReader {
  private readonly buf: Uint8Array;
  pos: number;
  readonly end: number;

  constructor(buf: Uint8Array, start = 0, end = buf.length) {
    this.buf = buf;
    this.pos = start;
    this.end = end;
  }

  hasMore(): boolean {
    return this.pos < this.end;
  }

  /**
   * Read an unsigned 64-bit varint as a JS number (accurate up to 2^53 - 1,
   * more than enough for Unix timestamps, stop sequences, and delays).
   */
  readVarintBig(): bigint {
    let result = 0n;
    let shift = 0n;
    while (this.pos < this.end) {
      const byte = this.buf[this.pos++];
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7n;
      if (shift > 70n) break;
    }
    return result;
  }

  readUint(): number {
    return Number(this.readVarintBig());
  }

  readInt32(): number {
    const raw = this.readVarintBig();
    // Protobuf encodes negative int32 as 64-bit two's complement varint
    const low32 = Number(raw & 0xffffffffn);
    return low32 | 0;
  }

  readInt64(): number {
    const raw = this.readVarintBig();
    const signed = raw >= 0x8000000000000000n ? raw - 0x10000000000000000n : raw;
    return Number(signed);
  }

  readTag(): { field: number; wireType: number } {
    const tag = this.readUint();
    return { field: tag >>> 3, wireType: tag & 0x7 };
  }

  readSubReader(): ProtoReader {
    const len = this.readUint();
    const start = this.pos;
    const end = Math.min(this.end, start + len);
    this.pos = end;
    return new ProtoReader(this.buf, start, end);
  }

  readString(): string {
    const len = this.readUint();
    const start = this.pos;
    const end = Math.min(this.end, start + len);
    this.pos = end;
    return textDecoder.decode(this.buf.subarray(start, end));
  }

  skipField(wireType: number): void {
    switch (wireType) {
      case 0: // varint
        this.readVarintBig();
        break;
      case 1: // 64-bit fixed
        this.pos = Math.min(this.end, this.pos + 8);
        break;
      case 2: { // length-delimited
        const len = this.readUint();
        this.pos = Math.min(this.end, this.pos + len);
        break;
      }
      case 5: // 32-bit fixed
        this.pos = Math.min(this.end, this.pos + 4);
        break;
      default:
        // Unknown / deprecated group wire type -> bail cleanly to end of sub-message
        this.pos = this.end;
        break;
    }
  }
}

function decodeStopTimeEvent(r: ProtoReader): DecodedStopTimeEvent {
  const out: DecodedStopTimeEvent = {};
  while (r.hasMore()) {
    const { field, wireType } = r.readTag();
    if (field === 1 && wireType === 0) {
      out.delay = r.readInt32();
    } else if (field === 2 && wireType === 0) {
      out.time = r.readInt64();
    } else {
      r.skipField(wireType);
    }
  }
  return out;
}

function decodeStopTimeUpdate(r: ProtoReader): DecodedStopTimeUpdate {
  const out: DecodedStopTimeUpdate = {};
  while (r.hasMore()) {
    const { field, wireType } = r.readTag();
    if (field === 1 && wireType === 0) {
      out.stopSequence = r.readUint();
    } else if (field === 2 && wireType === 2) {
      out.arrival = decodeStopTimeEvent(r.readSubReader());
    } else if (field === 3 && wireType === 2) {
      out.departure = decodeStopTimeEvent(r.readSubReader());
    } else if (field === 4 && wireType === 2) {
      out.stopId = r.readString();
    } else {
      r.skipField(wireType);
    }
  }
  return out;
}

function decodeTripDescriptor(r: ProtoReader): DecodedTripDescriptor {
  const out: DecodedTripDescriptor = {};
  while (r.hasMore()) {
    const { field, wireType } = r.readTag();
    if (field === 1 && wireType === 2) {
      out.tripId = r.readString();
    } else if (field === 5 && wireType === 2) {
      out.routeId = r.readString();
    } else if (field === 6 && wireType === 0) {
      out.directionId = r.readUint();
    } else {
      r.skipField(wireType);
    }
  }
  return out;
}

function decodeVehicleDescriptor(r: ProtoReader): DecodedVehicleDescriptor {
  const out: DecodedVehicleDescriptor = {};
  while (r.hasMore()) {
    const { field, wireType } = r.readTag();
    if (field === 1 && wireType === 2) {
      out.id = r.readString();
    } else if (field === 2 && wireType === 2) {
      out.label = r.readString();
    } else {
      r.skipField(wireType);
    }
  }
  return out;
}

function decodeTripUpdate(r: ProtoReader): DecodedTripUpdate {
  const out: DecodedTripUpdate = { stopTimeUpdate: [] };
  while (r.hasMore()) {
    const { field, wireType } = r.readTag();
    if (field === 1 && wireType === 2) {
      out.trip = decodeTripDescriptor(r.readSubReader());
    } else if (field === 2 && wireType === 2) {
      out.stopTimeUpdate.push(decodeStopTimeUpdate(r.readSubReader()));
    } else if (field === 3 && wireType === 2) {
      out.vehicle = decodeVehicleDescriptor(r.readSubReader());
    } else {
      r.skipField(wireType);
    }
  }
  return out;
}

function decodeFeedEntity(r: ProtoReader): DecodedFeedEntity {
  const out: DecodedFeedEntity = { id: '' };
  while (r.hasMore()) {
    const { field, wireType } = r.readTag();
    if (field === 1 && wireType === 2) {
      out.id = r.readString();
    } else if (field === 3 && wireType === 2) {
      out.tripUpdate = decodeTripUpdate(r.readSubReader());
    } else {
      r.skipField(wireType);
    }
  }
  return out;
}

function decodeFeedHeader(r: ProtoReader): DecodedFeedMessage['header'] {
  const out: DecodedFeedMessage['header'] = {};
  while (r.hasMore()) {
    const { field, wireType } = r.readTag();
    if (field === 1 && wireType === 2) {
      out.gtfsRealtimeVersion = r.readString();
    } else if (field === 3 && wireType === 0) {
      out.timestamp = r.readUint();
    } else {
      r.skipField(wireType);
    }
  }
  return out;
}

export function decodeGtfsRtFeedMessage(bytes: Uint8Array): DecodedFeedMessage {
  const r = new ProtoReader(bytes);
  const out: DecodedFeedMessage = {
    header: {},
    entity: [],
  };
  while (r.hasMore()) {
    const { field, wireType } = r.readTag();
    if (field === 1 && wireType === 2) {
      out.header = decodeFeedHeader(r.readSubReader());
    } else if (field === 2 && wireType === 2) {
      out.entity.push(decodeFeedEntity(r.readSubReader()));
    } else {
      r.skipField(wireType);
    }
  }
  return out;
}
