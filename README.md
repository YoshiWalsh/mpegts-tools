## mpegts-tools

This project aims to provide tools for reading and manipulating MPEG Transport Streams in Node.js.

## Features

### Fully-typed

Full TypeScript support right out of the box, no need for an @types package.

### PacketAligner stream transformer

This will take a stream of binary data and attempts to align it to MPEG TS packets, such that each output chunk starts at the beginning of a packet contains an integer amount of packets.

### Packet parsing

Parsing Packets, Adaptation Fields and Adaptation Extensions is working. Each property is retrieved from the underlying binary data when it's requested, so if you only use a small number of properties then unnecessary ones aren't loaded.

## Roadmap

 * Parsing of PAT and PMT table data
 * Support for editing (and even creating) packet data, table data