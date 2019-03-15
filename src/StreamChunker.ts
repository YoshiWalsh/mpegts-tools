import { Transform, TransformCallback } from 'stream';

/**
 * This transformer takes a stream and splits it into chunks of a certain length.
 */
export class StreamChunker extends Transform {
	private _size: number;
	private _flushOnEnd: boolean;
	private buffer: Buffer;
	private pointer: number = 0;

	public constructor(chunkSize: number, flush?: boolean) {
		super();

		this._size = chunkSize;
		this._flushOnEnd = flush || false;
		this.buffer = Buffer.alloc(chunkSize);
	}

	public _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback) {
		let index = 0;
		while(index < chunk.length) {
			const writeable = Math.min(this._size - this.pointer, chunk.length - index);
			chunk.copy(this.buffer, this.pointer, index, index + writeable);
			index += writeable;
			this.pointer += writeable;
			if(this.pointer >= this._size) {
				const outputBuffer = Buffer.alloc(this._size);
				this.buffer.copy(outputBuffer);
				this.push(outputBuffer);
				this.pointer = 0;
			}
		}
		callback();
	}

	public _flush() {
		if(this._flushOnEnd && this.pointer !== 0) {
			this.push(this.buffer.slice(0, this.pointer));
		}
	}
}