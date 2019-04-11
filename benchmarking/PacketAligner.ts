import * as fs from 'fs';
import { performance } from 'perf_hooks';
import { Readable } from 'stream';
import { PacketAligner, MPEGTS_PACKET_LENGTH } from "../src/index";

const maximumSkipToTolerate = MPEGTS_PACKET_LENGTH;
const segmentBytes = 1024; // This doesn't align nicely with the packet length (188) so PacketAligner will need to compensate
const benchmarkTotalBytes = 1024 * 1024 * 512; // Must not exceed buffer.constants.MAX_LENGTH

const inputVideoStream = fs.createReadStream(process.argv[2], { start: 1, end: 1 + benchmarkTotalBytes });
let inputVideo = Buffer.alloc(benchmarkTotalBytes);
// Remove the first byte to ensure PacketAligner has to work to find the initial alignment, assuming the input video file was initially aligned
let inputPointer = 0;
const inputStream = new Readable({
	read(size: number) {
		this.push(inputVideo.slice(inputPointer, inputPointer + segmentBytes));
		inputPointer += segmentBytes;
		if(inputPointer >= inputVideo.length) {
			this.push(null);
		}
	}
});

console.log("Initialising");
let readPointer = 0;
inputVideoStream.on('data', (data: Buffer) => {
	data.copy(inputVideo, readPointer);
	readPointer += data.length;
});
inputVideoStream.once('end', () => {
	console.log("Starting benchmark");
	const start = performance.now();
	
	const outputStream = inputStream.pipe(new PacketAligner());
	let outputPointer = 0;
	const outputBuffer = Buffer.alloc(inputVideo.length);

	outputStream.on('data', (data: Buffer) => {
		data.copy(outputBuffer, outputPointer);
		outputPointer += data.length;
	});
	outputStream.on('end', () => {
		const end = performance.now();
		const timeTaken = end - start;
		console.log("Processed " + inputVideo.length + " Bytes in " + (timeTaken / 1000) + " seconds. (avg. " + ((inputVideo.length / 1024 / 1024) / (timeTaken / 1000)) + " MiB/s)");
		console.log("Verifying data");
		let verificationPointer = 0;
		for(let pointer = 0; pointer < outputPointer; pointer += MPEGTS_PACKET_LENGTH) {
			const data = outputBuffer.slice(pointer, MPEGTS_PACKET_LENGTH);
			const skippedBytes = inputVideo.slice(verificationPointer, verificationPointer + maximumSkipToTolerate + data.length).indexOf(data);
			if(skippedBytes < 0) {
				throw new Error("Data stream corrupted");
			}
			if(skippedBytes > 0) {
				console.log("Alignment skipped", skippedBytes, "bytes");
			}
			verificationPointer += skippedBytes + data.length;
		}
		console.log("Verification complete");
	});
});