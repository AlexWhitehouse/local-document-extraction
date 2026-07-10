export type DataType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "object"
  | "array"
  | "array<object>";

export type FieldDefinition = {
  id: string;
  name: string;
  description: string;
  data_type: DataType;
};

export type ExtractOptions = {
  include_confidence?: boolean;
  include_evidence?: boolean;
};
