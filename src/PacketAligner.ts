import { Transform, TransformCallback } from 'stream';
import { MPEGTS_PACKET_LENGTH, MPEGTS_SYNC_BYTE } from './Packets';

/**
 * This transformer takes an MPEG Transport Stream and aligns it so that each chunk will always start at the beginning of a packet, and will contain an integer amount of packets.
 * 
 * This makes it simple to parse and perform operations on the packets.
 */
export class PacketAligner extends Transform {
	private buffer: Buffer = Buffer.alloc(0, undefined, "binary");
	private syncAcquired = false;

	public constructor() {
		super();
	}

	public _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback) {
		try {
			this.buffer = Buffer.concat([this.buffer, chunk]);
			if(!this.syncAcquired) {
				const syncByteIndex = this.buffer.indexOf(MPEGTS_SYNC_BYTE, 0, "binary");
				this.buffer = this.buffer.slice(syncByteIndex >= 0 ? syncByteIndex : this.buffer.length);
				while(this.buffer.length > MPEGTS_PACKET_LENGTH * 2 + 1) {
					// Search for 3 properly-spaced sync bytes in a row
					if(
						this.buffer[MPEGTS_PACKET_LENGTH * 0] === MPEGTS_SYNC_BYTE &&
						this.buffer[MPEGTS_PACKET_LENGTH * 1] === MPEGTS_SYNC_BYTE &&
						this.buffer[MPEGTS_PACKET_LENGTH * 2] === MPEGTS_SYNC_BYTE
					) {
						this.syncAcquired = true;
						break;
					}
					
					const syncByteIndex = this.buffer.indexOf(MPEGTS_SYNC_BYTE, 1, "binary");
					this.buffer = this.buffer.slice(syncByteIndex >= 0 ? syncByteIndex : this.buffer.length);
				}
			}
			if(this.syncAcquired) {
				while(this.buffer.length > MPEGTS_PACKET_LENGTH) {
					if(this.buffer[MPEGTS_PACKET_LENGTH] === MPEGTS_SYNC_BYTE) {
						this.push(this.buffer.slice(0, MPEGTS_PACKET_LENGTH));
						this.buffer = this.buffer.slice(MPEGTS_PACKET_LENGTH);
					} else {
						this.syncAcquired = false;
						break;
					}
				}
			}
			callback(null);
		} catch (ex) {
			callback(ex);
		}
	}
}