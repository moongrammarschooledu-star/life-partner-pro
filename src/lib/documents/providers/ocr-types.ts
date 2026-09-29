export interface OcrResult {
  supported: boolean;
  text?: string;
  fields?: Record<string, string>;
  detectedType?: string;
}

export interface DocumentOcrProvider {
  readonly key: string;
  extractText(bytes: Buffer, mimeType: string): Promise<OcrResult>;
  detectDocumentType(bytes: Buffer, mimeType: string): Promise<OcrResult>;
  extractFields(bytes: Buffer, mimeType: string): Promise<OcrResult>;
}
