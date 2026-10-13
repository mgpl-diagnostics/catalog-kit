/** How a parameter's result is entered and its reference shown. */
export type ParameterType =
  | "numeric" // a number checked against male/female bounds
  | "text" // free text; reference is a narrative (referenceText)
  | "options" // pick from a list (e.g. Positive / Negative)
  | "image" // an uploaded image (e.g. electrophoresis)
  | "title"; // a heading row inside the report

/** One side of a reference interval. Usually numbers; text when the lab wrote e.g. "<0.5". */
export type Bound = number | string | null;

export interface Interval {
  low: Bound;
  high: Bound;
}

export interface Parameter {
  /** e.g. "Hemoglobin". null for untitled narrative rows. */
  name: string | null;
  /** Canonical unit, e.g. "g/dL", "IU/mL", "µmol/L". */
  unit: string | null;
  /** Canonical method, e.g. "CLIA", "Calculated", "Electrical Impedance". */
  method: string | null;
  type: ParameterType;
  /** Order in the printed report. */
  position: number | null;
  male: Interval | null;
  female: Interval | null;
  /** Allowed values when type is "options". */
  options: string[] | null;
  /** True when the value is derived from other parameters. */
  calculated: boolean;
  /** Formula as stored by the lab software (refers to parameters as pr_<id>). */
  formula: string | null;
  /** Same formula with parameter names, e.g. "(28.7*HBA1C)-46.7". */
  formulaText: string | null;
  /** Narrative reference (age bands, interpretation), HTML stripped. */
  referenceText: string | null;
}

export type Department =
  | "CLINICAL BIOCHEMISTRY"
  | "CLINICAL PATHOLOGY"
  | "CYTOPATHOLOGY"
  | "HEMATOLOGY"
  | "HISTOPATHOLOGY"
  | "IMMUNOLOGY"
  | "MICROBIOLOGY"
  | "MOLECULAR"
  | "SEROLOGY"
  | (string & {});

export interface LabTest {
  id: number;
  name: string;
  code: string | null;
  shortCode: string | null;
  searchCode: string | null;
  /** Price in rupees. */
  mrp: number | null;
  department: Department;
  /** Primary sample, e.g. "SERUM", "EDTA", "URINE". */
  sampleType: string | null;
  secondarySampleTypes: string[] | null;
  parameterCount: number;
  parameters: Parameter[];
}

export interface Catalog {
  generatedAt: string;
  source: string;
  tests: LabTest[];
}

export type Sex = "male" | "female";
