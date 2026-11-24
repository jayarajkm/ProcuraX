export const DOC_CATEGORIES = ['policy', 'procedure', 'guideline', 'standard', 'contract', 'general'] as const
export const DOC_EXTENSIONS = ['pdf', 'docx', 'txt', 'csv'] as const
/** Mirrors the server default (max_upload_mb); the server remains the authority and its message is shown on 422. */
export const MAX_UPLOAD_MB = 20

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Returns an error message, or null if the file passes client-side pre-validation. */
export function validateUpload(file: { name: string; size: number } | null | undefined, maxMb = MAX_UPLOAD_MB): string | null {
  if (!file) return 'Choose a file to upload'
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  if (!(DOC_EXTENSIONS as readonly string[]).includes(ext)) return `Unsupported file type ".${ext || '?'}". Allowed: ${DOC_EXTENSIONS.map((e) => `.${e}`).join(', ')}`
  if (file.size === 0) return 'The file is empty'
  if (file.size > maxMb * 1024 * 1024) return `File is ${formatBytes(file.size)}; the limit is ${maxMb} MB`
  return null
}
