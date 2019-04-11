import * as fs from 'fs';
import { performance } from 'perf_hooks';
import { Readable } from 'stream';
import { PacketAligner, MPEGTS_PACKET_LENGTH } from "../src/index";

const maximumSkipToTolerate = MPEGTS_PACKET_LENGTH;
const segmentBytes = 1024; // This doesn't align nicely with the packet length (188) so PacketAligner will need to compensate
const benchmarkBytes = 1024 * 1024 * 512; // Must not exceed buffer.constants.MAX_LENGTH

async function runBenchmark() {
	const inputFiles = process.argv.slice(2);
	const inputVideoStreams = inputFiles.map(f => fs.createReadStream(f, { start: 1, end: 1 + benchmarkBytes })); // Remove the first byte to ensure PacketAligner has to work to find the initial alignment, assuming the input video file was initially aligned
	
	console.log("Initialising");
	const inputVideoBuffers = await Promise.all(inputVideoStreams.map(s => {
		let readPointer = 0;
		return new Promise<Buffer>((resolve, reject) => {
			const buffer = Buffer.alloc(benchmarkBytes);
			s.on('data', (data: Buffer) => {
				data.copy(buffer, readPointer);
				readPointer += data.length;
			});
			s.once('end', () => {
				resolve(buffer);
			});
		});
	}));

	console.log("Starting benchmark");
	const start = performance.now();

	const inputAndOutputBuffers = await Promise.all(inputVideoBuffers.map(inputVideo => {
		return new Promise<{ input: Buffer, output: Buffer }>((resolve, reject) => {
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

			const outputStream = inputStream.pipe(new PacketAligner());
			let outputPointer = 0;
			const outputBuffer = Buffer.alloc(inputVideo.length);

			outputStream.on('data', (data: Buffer) => {
				data.copy(outputBuffer, outputPointer);
				outputPointer += data.length;
			});
			outputStream.on('end', () => {
				resolve({
					input: inputVideo,
					output: outputBuffer.slice(0, outputPointer)
				});
			});
		});
	}));

	const end = performance.now();
	const timeTaken = end - start;
	const totalData = inputVideoBuffers.reduce((tot, cur) => tot + cur.length, 0);
	console.log("Processed " + totalData + " Bytes in " + (timeTaken / 1000) + " seconds. (avg. " + ((totalData / 1024 / 1024) / (timeTaken / 1000)) + " MiB/s, " + ((totalData / 1024 / 1024) / (timeTaken / 1000) / inputVideoBuffers.length) + " MiB/s/input)");
	console.log("Verifying data");
	await Promise.all(inputAndOutputBuffers.map(io => {
		let verificationPointer = 0;
		for(let pointer = 0; pointer < io.output.length; pointer += MPEGTS_PACKET_LENGTH) {
			const data = io.output.slice(pointer, MPEGTS_PACKET_LENGTH);
			const skippedBytes = io.input.slice(verificationPointer, verificationPointer + maximumSkipToTolerate + data.length).indexOf(data);
			if(skippedBytes < 0) {
				throw new Error("Data stream corrupted");
			}
			if(skippedBytes > 0) {
				console.log("Alignment skipped", skippedBytes, "bytes");
			}
			verificationPointer += skippedBytes + data.length;
		}
	}));
	console.log("Verification complete");
	
	return;
}

runBenchmark().then(() => {

}, (err) => {
	throw err;
});