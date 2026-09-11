// The validator lives in @pressline/contract so the conformance suite runs the
// same code as the bridge (ticket #21). Re-exported here for the app's imports.
export {
  HEADER_BYTES,
  InvalidReason,
  PrintfileInvalid,
  PrintfileInspection,
  inspectPrintfile,
  parseImageHeader,
  validatePrintfile,
  type ImageHeader,
} from '@pressline/contract';
