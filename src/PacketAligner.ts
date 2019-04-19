import { Transform, TransformCallback } from 'stream';
import { MPEGTS_PACKET_LENGTH, MPEGTS_SYNC_BYTE } from './Packets';
import { timingSafeEqual } from 'crypto';

/**
 * This transformer takes an MPEG Transport Stream and aligns it so that each chunk will always start at the beginning of a packet, and will contain an integer amount of packets.
 * 
 * This makes it simple to parse and perform operations on the packets.
 */
export class PacketAligner extends Transform {
	private leftoversMaxLength = MPEGTS_PACKET_LENGTH * 3;
	private leftovers: Buffer = Buffer.alloc(this.leftoversMaxLength, undefined);
	private leftoversEnd = 0;
	private temp: Buffer = Buffer.alloc(this.leftoversMaxLength, undefined); // This is used as temporary storage for the leftovers value in case we need to shift it
	private emptyBuffer = Buffer.alloc(0);
	private syncAcquired = false;

	public constructor() {
		super();
	}

	private indexOfLeftoversAndChunk(chunk: Buffer, value: number, byteOffset: number): number {
		const positionWithinLeftovers = this.leftovers.slice(0, this.leftoversEnd).indexOf(value, byteOffset);
		if(positionWithinLeftovers !== -1) {
			return positionWithinLeftovers;
		}

		const positionWithinChunk = chunk.indexOf(value, byteOffset + this.leftoversEnd);
		if(positionWithinChunk !== -1) {
			return positionWithinChunk + this.leftoversEnd;
		}
		return -1;
	}

	private getByteFromLeftoversAndChunk(chunk: Buffer, index: number): number {
		if(index < this.leftoversEnd) {
			return this.leftovers[index];
		} else {
			return chunk[index - this.leftoversEnd];
		}
	}

	private shiftLeftovers(amount: number) {
		if(amount >= this.leftoversEnd) {
			this.leftoversEnd = 0;
			return;
		}
		this.leftovers.slice(amount).copy(this.temp);
		this.leftoversEnd -= amount;
		this.temp.copy(this.leftovers, 0, 0, this.leftoversEnd);
	}

	private shiftLeftoversAndChunk(chunk: Buffer, amount: number): Buffer {
		const amountToShiftChunk = Math.max(0, amount - this.leftoversEnd);

		if(amountToShiftChunk >= chunk.length) {
			chunk = this.emptyBuffer;
		} else if (amountToShiftChunk > 0) {
			chunk = chunk.slice(amountToShiftChunk);
		}
		
		this.shiftLeftovers(amount);
		return chunk;
	}

	private appendToLeftovers(chunk: Buffer, minimumShift?: number) {
		if(chunk.length > this.leftoversMaxLength) {
			chunk = chunk.slice(chunk.length - this.leftoversMaxLength);
		}

		const totalSize = this.leftoversEnd + chunk.length;
		let shiftAmount = totalSize - this.leftoversMaxLength;
		if(minimumShift && shiftAmount < minimumShift) {
			shiftAmount = minimumShift;
		}
		if(shiftAmount > 0) {
			this.shiftLeftovers(shiftAmount);
		}
		if(chunk.length > 0) {
			chunk.copy(this.leftovers, this.leftoversEnd);
		}
		this.leftoversEnd += chunk.length;
	}

	public _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback) {
		try {
			let output = [];
			while (this.leftoversEnd + chunk.length > (this.syncAcquired ? MPEGTS_PACKET_LENGTH : (MPEGTS_PACKET_LENGTH * 2 + 1))) {
				if(!this.syncAcquired) {
					const syncByteIndex = this.indexOfLeftoversAndChunk(chunk, MPEGTS_SYNC_BYTE, 0);
					// Search for 3 properly-spaced sync bytes in a row
					if(
						this.getByteFromLeftoversAndChunk(chunk, syncByteIndex + MPEGTS_PACKET_LENGTH * 0) === MPEGTS_SYNC_BYTE &&
						this.getByteFromLeftoversAndChunk(chunk, syncByteIndex + MPEGTS_PACKET_LENGTH * 1) === MPEGTS_SYNC_BYTE &&
						this.getByteFromLeftoversAndChunk(chunk, syncByteIndex + MPEGTS_PACKET_LENGTH * 2) === MPEGTS_SYNC_BYTE
					) {
						chunk = this.shiftLeftoversAndChunk(chunk, syncByteIndex);
						this.syncAcquired = true;
						continue;
					}
					
					this.appendToLeftovers(chunk, 1);
					chunk = this.emptyBuffer;
				} else {
					let packetsFound = 0;
					for (let currentIndex = MPEGTS_PACKET_LENGTH; currentIndex < this.leftoversEnd + chunk.length; currentIndex += MPEGTS_PACKET_LENGTH) {
						if(this.getByteFromLeftoversAndChunk(chunk, currentIndex) === MPEGTS_SYNC_BYTE) {
							packetsFound++;
						} else {
							this.syncAcquired = false;
							break;
						}
					}

					let foundPacketsLength = packetsFound * MPEGTS_PACKET_LENGTH;
					if(packetsFound > 0 && this.leftoversEnd > 0) {
						output.push(this.leftovers.slice(0, this.leftoversEnd));
					}
					if(foundPacketsLength > this.leftoversEnd) {
						output.push(chunk.slice(0, foundPacketsLength - this.leftoversEnd));
					}
					chunk = this.shiftLeftoversAndChunk(chunk, foundPacketsLength);
				}
				if(output.length > 0) {
					this.push(Buffer.concat(output));
					output = [];
				}
			}
			this.appendToLeftovers(chunk);
			callback(null);
		} catch (ex) {
			callback(ex);
		}
	}
}