import { SOURCE_FILE_MIME_TYPES } from "../../lib/runtimeConfiguration";

// One rule set for Document uploads: the backend's extraction types and the runtime size limit.
export const ACCEPTED_FILE_TYPES = SOURCE_FILE_MIME_TYPES;

export function formatUploadLimit(bytes) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(bytes / (1024 * 1024))} MB`;
}

// Splits picked files into accepted files and one readable reason per rejected file.
export function validateSourceFiles(files, maxSourceFileBytes) {
  const accepted = [];
  const rejections = [];

  for (const file of files) {
    if (!ACCEPTED_FILE_TYPES.includes(file.type)) {
      rejections.push(`${file.name} isn't a PDF, PNG, JPG or WEBP file`);
    } else if (file.size > maxSourceFileBytes) {
      rejections.push(`${file.name} is larger than ${formatUploadLimit(maxSourceFileBytes)}`);
    } else {
      accepted.push(file);
    }
  }

  return { accepted, rejections };
}
