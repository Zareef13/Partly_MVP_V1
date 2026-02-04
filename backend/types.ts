
export interface RawComponentData {
  mpn: string;
  manufacturer: string;
}

export interface SpecAttribute {
  attribute: string;
  value: string;
  unit: string;
  // sourceId is optional and used for mapping technical specs to grounding citations.
  sourceId?: number;
}

export interface EnrichedComponentData extends RawComponentData {
  description: string;
  features: string[];
  sources: Array<{ title: string; uri: string; id: number }>;
  citationMap: Record<number, string>; // Maps citation ID to URL
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
  datasheetUrl?: string;
  imageUrl?: string;
  corpus?: string;
  reasoning?: string;
  flags: string[];
  sourceCount: number;
  confidence?: 'high' | 'medium' | 'low';
  specTable?: SpecAttribute[];
}

export interface ProcessingStats {
  total: number;
  completed: number;
  errors: number;
}
