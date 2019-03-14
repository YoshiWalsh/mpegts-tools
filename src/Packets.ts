export const MPEGTS_SYNC_BYTE = 0x47;
export const MPEGTS_PACKET_LENGTH = 188;

export enum TransportScramblingControlValues {
	NotScrambled = 0,
	ScrambledWithEvenKey = 2,
	ScrambledWithOddKey = 3,
	Reserved = 1
}

export enum AdaptationFieldControlValues {
	NoAdaptationField = 1,
	AdaptationFieldOnly = 2,
	AdaptationFieldAndPayload = 3,
	Reserved = 0
}

export interface IPacketData {
	transportErrorIndicator: boolean;
	payloadUnitStartIndicator: boolean;
	transportPriority: boolean;
	/**
	 * 13-bit unsigned integer identifying the packet
	 */
	pid: number;
	transportScramblingControl: TransportScramblingControlValues;
	adaptationFieldControl: AdaptationFieldControlValues;
	continuityCounter: number;
	adaptationField: IAdaptationField | null;
	payload: Buffer | null;
	raw: Buffer;
}

export interface IAdaptationField {
	adaptationFieldLength: number;
	discontinuityIndicator: boolean;
	randomAccessIndicator: boolean;
	elementaryStreamPriorityIndicator: boolean;
	pcrFlag: boolean;
	opcrFlag: boolean;
	splicingPointFlag: boolean;
	transportPrivateDataFlag: boolean;
	adaptationFieldExtensionFlag: boolean;
	pcr: number | null;
	opcr: number | null;
	spliceCountdown: number | null;
	transportPrivateDataLength: number | null;
	transportPrivateData: Buffer | null;
	adaptationExtension: IAdaptationExtension | null;
}

export interface IAdaptationExtension {
	adaptationExtensionLength: number;
	legalTimeWindowFlag: boolean;
	piecewiseRateFlag: boolean;
	seamlessSpliceFlag: boolean;
	legalTimeWindowValidFlag: boolean;
	legalTimeWindowOffset: number;
	piecewiseRate: number;
	spliceType: number;
	dtsNextAccessUnit: number;
}

export class PacketData implements IPacketData {
	private _chunk: Buffer;
	private _adaptationField?: IAdaptationField;

	constructor(chunk: Buffer) {
		if(chunk.length !== MPEGTS_PACKET_LENGTH) {
			throw new Error("Attempt to parse a packet with the wrong length. MPEGTS packets should always be " + MPEGTS_PACKET_LENGTH + " in length.");
		}
		if(chunk[0] !== MPEGTS_SYNC_BYTE) {
			throw new Error("Attempt to parse invalid packet. MPEGTS packets must always start with a 0x" + MPEGTS_SYNC_BYTE.toString(16) + " sync byte.");
		}

		this._chunk = chunk;
	}

	public get transportErrorIndicator() {
		return !!(this._chunk[1] & 0x80);
	}

	public get payloadUnitStartIndicator() {
		return !!(this._chunk[1] & 0x40);
	}

	public get transportPriority() {
		return !!(this._chunk[1] & 0x20);
	}

	public get pid() {
		return ((this._chunk[1] & 0x1f) * 256) | this._chunk[2];
	}

	public get transportScramblingControl() {
		return <TransportScramblingControlValues> (this._chunk[3] & 0xc0) / 64;
	}

	public get adaptationFieldControl() {
		return <AdaptationFieldControlValues> (this._chunk[3] & 0x30) / 16;
	}

	public get continuityCounter() {
		return (this._chunk[3] & 0xf);
	}

	/**
	 * Total length of the adaptation field, including the adaptation field length byte
	 * 
	 * @remarks
	 * See also the [adaptationFieldLength property]{@link AdaptationField#adaptationFieldLength} within the adaptationField, which excludes the adaptation field length byte
	 */
	public get adaptationFieldTotalLength() {
		switch(this.adaptationFieldControl) {
			case AdaptationFieldControlValues.AdaptationFieldOnly:
			case AdaptationFieldControlValues.AdaptationFieldAndPayload:
				return 1 + this._chunk[4];

			case AdaptationFieldControlValues.NoAdaptationField:
			default:
				return 0;
		}
	}

	public get adaptationField() {
		switch(this.adaptationFieldControl) {
			case AdaptationFieldControlValues.AdaptationFieldOnly:
			case AdaptationFieldControlValues.AdaptationFieldAndPayload:
				return this._adaptationField || (this._adaptationField = new AdaptationField(this._chunk.slice(4, 4 + this.adaptationFieldTotalLength)));

			case AdaptationFieldControlValues.NoAdaptationField:
			default:
				return null;
		}
	}

	public get payload() {
		switch(this.adaptationFieldControl) {
			case AdaptationFieldControlValues.NoAdaptationField:
			case AdaptationFieldControlValues.AdaptationFieldAndPayload:
				return this._chunk.slice(4 + this.adaptationFieldTotalLength);
			case AdaptationFieldControlValues.AdaptationFieldOnly:
			default:
				return null;
		}
	}

	/**
	 * @readonly
	 */
	public get raw() {
		return this._chunk;
	}
}

export class AdaptationField implements IAdaptationField {
	private _chunk: Buffer;
	private _adaptationExtension?: AdaptationExtension;

	constructor(chunk: Buffer) {
		this._chunk = chunk;
	}

	public get adaptationFieldLength() {
		return this._chunk[0];
	}

	public get discontinuityIndicator() {
		return !!(this._chunk[1] & 0x80);
	}

	public get randomAccessIndicator() {
		return !!(this._chunk[1] & 0x40);
	}

	public get elementaryStreamPriorityIndicator() {
		return !!(this._chunk[1] & 0x20);
	}

	public get pcrFlag() {
		return !!(this._chunk[1] & 0x10);
	}

	public get opcrFlag() {
		return !!(this._chunk[1] & 0x8);
	}

	public get splicingPointFlag() {
		return !!(this._chunk[1] & 0x4);
	}

	public get transportPrivateDataFlag() {
		return !!(this._chunk[1] & 0x2);
	}

	public get adaptationFieldExtensionFlag() {
		return !!(this._chunk[1] & 0x1);
	}

	private get _pcrOffset() {
		return 2;
	}

	public get pcr() {
		if(!this.pcrFlag) {
			return null;
		}

		const base = this._chunk.readUInt32BE(this._pcrOffset) * 2 + (this._chunk[this._pcrOffset + 4] & 0x80) >>> 7;
		const extension = this._chunk[this._pcrOffset + 4] & 0x1 * 256 + this._chunk[this._pcrOffset + 5];
		return base * 300 + extension;
	}

	private get _opcrOffset() {
		return this._pcrOffset + (this.pcrFlag ? 6 : 0);
	}

	public get opcr() {
		if(!this.opcrFlag) {
			return null;
		}
		
		const base = this._chunk.readUInt32BE(this._opcrOffset) * 2 + (this._chunk[this._opcrOffset + 4] & 0x80) >>> 7;
		const extension = this._chunk[this._opcrOffset + 4] & 0x1 * 256 + this._chunk[this._opcrOffset + 5];
		return base * 300 + extension;
	}

	private get _spliceCountdownOffset() {
		return this._opcrOffset + (this.opcrFlag ? 6 : 0);
	}

	public get spliceCountdown() {
		if(!this.splicingPointFlag) {
			return null;
		}
		
		return this._chunk.readInt8(this._spliceCountdownOffset);
	}

	private get _transportPrivateDataLengthOffset() {
		return this._spliceCountdownOffset + (this.splicingPointFlag ? 1 : 0);
	}

	public get transportPrivateDataLength() {
		if(!this.transportPrivateDataFlag) {
			return null;
		}
		return this._chunk[this._transportPrivateDataLengthOffset];
	}

	private get _transportPrivateDataOffset() {
		return this._transportPrivateDataLengthOffset + (this.transportPrivateDataFlag ? 1 : 0);
	}

	public get transportPrivateData() {
		if(!this.transportPrivateDataFlag) {
			return null;
		}
		return this._chunk.slice(this._transportPrivateDataOffset, this._transportPrivateDataOffset * (this.transportPrivateDataLength || 0));
	}

	private get _adaptationExtensionOffset() {
		return this._transportPrivateDataOffset + (this.transportPrivateDataLength || 0);
	}

	/**
	 * Total length of the adaptation extension, including the adaptation extension length byte
	 * 
	 * @remarks
	 * See also the [adaptationExtensionLength property]{@link AdaptationExtension#adaptationExtensionLength} within the adaptationExtension, which excludes the adaptation extension length byte
	 */
	public get adaptationExtensionTotalLength() {
		if(!this.adaptationFieldExtensionFlag) {
			return 0;
		}

		return 1 + this._chunk[this._adaptationExtensionOffset];
	}

	public get adaptationExtension() {
		if(!this.adaptationFieldExtensionFlag) {
			return null;
		}
		
		return this._adaptationExtension || (this._adaptationExtension = new AdaptationExtension(this._chunk.slice(this._adaptationExtensionOffset, this._adaptationExtensionOffset + this.adaptationExtensionTotalLength)));
	}
}

export class AdaptationExtension implements IAdaptationExtension {
	private _chunk: Buffer;

	constructor(chunk: Buffer) {
		this._chunk = chunk;
	}

	public get adaptationExtensionLength() {
		return this._chunk[0];
	}

	public get legalTimeWindowFlag() {
		return !!(this._chunk[1] & 0x80);
	}

	public get piecewiseRateFlag() {
		return !!(this._chunk[1] & 0x40);
	}

	public get seamlessSpliceFlag() {
		return !!(this._chunk[1] & 0x20);
	}

	private get ltwFlagSetOffset() {
		return 2;
	}

	public get legalTimeWindowValidFlag() {
		return !!(this._chunk[this.ltwFlagSetOffset] & 0x80);
	}

	public get legalTimeWindowOffset() {
		return (this._chunk[this.ltwFlagSetOffset] & 0x7f) * 256 + this._chunk[this.ltwFlagSetOffset + 1];
	}

	private get piecewiseFlagSetOffset() {
		return this.ltwFlagSetOffset + (this.legalTimeWindowFlag ? 2 : 0);
	}

	public get piecewiseRate() {
		return (this._chunk[this.piecewiseFlagSetOffset] & 0x3f) * 256 * 256 + this._chunk[this.piecewiseFlagSetOffset + 1] * 256 + this._chunk[this.piecewiseFlagSetOffset + 2];
	}

	private get seamlessSpliceFlagSetOffset() {
		return this.piecewiseFlagSetOffset + (this.piecewiseFlagSetOffset ? 3 : 0);
	}

	public get spliceType() {
		return this._chunk[this.seamlessSpliceFlagSetOffset] & 0xf0 >>> 4;
	}

	public get dtsNextAccessUnit() {
		return ((this._chunk[this.seamlessSpliceFlagSetOffset] & 0x0e) >>> 1) * 128 * 256 * 128 * 256
			+ (this._chunk[this.seamlessSpliceFlagSetOffset + 1]) * 128 * 256 * 128
			+ ((this._chunk[this.seamlessSpliceFlagSetOffset + 2] & 0xfe) >>> 1) * 128 * 256
			+ (this._chunk[this.seamlessSpliceFlagSetOffset + 3]) * 128
			+ ((this._chunk[this.seamlessSpliceFlagSetOffset + 4] & 0xfe) >>> 1);
	}
}