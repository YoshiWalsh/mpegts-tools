import * as fs from 'fs';
import { performance } from 'perf_hooks';
import { Readable } from 'stream';
import { PacketData, MPEGTS_PACKET_LENGTH } from "../src/index";

const maximumSkipToTolerate = MPEGTS_PACKET_LENGTH;
const benchmarkBytes = 1024 * 1024 * 2 * MPEGTS_PACKET_LENGTH; // Must not exceed buffer.constants.MAX_LENGTH

async function runBenchmark() {
	const inputFile = process.argv[2];
	const inputVideoStream = fs.createReadStream(inputFile, { start: 0, end: benchmarkBytes }); // Assumes the input video file is already correctly packet-aligned
	
	console.log("Initialising");
	const inputVideoBuffer = await new Promise<Buffer>((resolve, reject) => {
		const buffer = Buffer.alloc(benchmarkBytes);
		let readPointer = 0;
		inputVideoStream.on('data', (data: Buffer) => {
			data.copy(buffer, readPointer);
			readPointer += data.length;
		});
		inputVideoStream.once('end', () => {
			resolve(buffer);
		});
	});

	console.log("Starting benchmark");
	const start = performance.now();

	const packetCount = Math.floor(inputVideoBuffer.length / MPEGTS_PACKET_LENGTH);
	for(let i = 0; i < packetCount; i++) {
		const packet = new PacketData(inputVideoBuffer.slice(MPEGTS_PACKET_LENGTH * i, MPEGTS_PACKET_LENGTH * (i + 1)));

		// You might think that since these values are never used anywhere, JavaScript might optimise out these assignments. After numerous tests, it appears that this is not the case.
		// However if you don't trust it, you can consider adding all these values into a running total and then logging it after all the packets have been processed, which will prove that work was being done.
		// You could also just comment out the following lines and notice that the performance improves a little bit.
		const pid = packet.pid;
		const adaptationFieldLength = packet.adaptationField && packet.adaptationField.adaptationFieldLength;
		const adaptationExtensionLength = packet.adaptationField && packet.adaptationField.adaptationExtension && packet.adaptationField.adaptationExtension.adaptationExtensionLength;
	}

	const end = performance.now();
	const timeTaken = end - start;
	const totalData = packetCount * MPEGTS_PACKET_LENGTH;
	console.log("Processed " + packetCount + " packets (" + totalData + " Bytes) in " + (timeTaken / 1000) + " seconds. (avg. " + ((totalData / 1024 / 1024) / (timeTaken / 1000)) + " MiB/s)");
	
	return;
}

runBenchmark().then(() => {

}, (err) => {
	throw err;
});