import { Eye, Info, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Can } from '@/auth/Can'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { Drawer } from '@/components/Drawer'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { ListCard } from '@/components/ListToolbar'
import { PageHeader } from '@/components/PageHeader'
import { Pagination } from '@/components/Pagination'
import { SearchInput } from '@/components/SearchInput'
import { DetailSkeleton } from '@/components/Skeletons'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { useDeleteDocument, useDocumentChunks, useDocuments, useReprocessDocument, useUploadDocument } from '@/hooks/api'
import { useListState } from '@/hooks/useListState'
import { errorMessage } from '@/lib/api'
import { fmtDateTime, titleCase } from '@/lib/format'
import type { DocumentRow } from '@/lib/types'
import { DOC_CATEGORIES, DOC_EXTENSIONS, MAX_UPLOAD_MB, formatBytes, validateUpload } from './documentRules'

const STATUSES = ['uploaded', 'processing', 'indexed', 'failed']
const DOC_TONES: Record<string, BadgeTone> = { uploaded: 'blue', processing: 'amber', indexed: 'green', failed: 'red' }

export function DocStatusBadge({ doc }: { doc: DocumentRow }) {
  return (
    <div className="space-y-0.5">
      <Badge tone={DOC_TONES[doc.status] ?? 'neutral'}>{titleCase(doc.status)}</Badge>
      {doc.error && <p className="max-w-xs break-words text-xs text-destructive">{doc.error}</p>}
    </div>
  )
}

export function UploadDocumentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const upload = useUploadDocument()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<string>('general')
  const [fileError, setFileError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) { setFile(null); setTitle(''); setCategory('general'); setFileError(null); setServerError(null) } }, [open])

  const pick = (f: File | null) => {
    setFile(f); setServerError(null)
    setFileError(f ? validateUpload(f) : null)
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''))
  }
  const submit = () => {
    const err = validateUpload(file)
    setFileError(err)
    if (err || !file) return
    setServerError(null)
    upload.mutate({ file, title, category }, {
      onSuccess: () => onOpenChange(false),
      // the hook toasts too; keep the message inline so it stays visible next to the form
      onError: (e) => setServerError(errorMessage(e)),
    })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Upload document" description={`Accepted: ${DOC_EXTENSIONS.map((e) => `.${e}`).join(', ')} up to ${MAX_UPLOAD_MB} MB.`}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={upload.isPending || !!fileError}>{upload.isPending ? 'Uploading…' : 'Upload'}</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <Field label="File" htmlFor="doc-file" error={fileError ?? undefined}>
          <Input id="doc-file" ref={input} type="file" accept=".pdf,.docx,.txt,.csv" className="h-auto py-1.5" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </Field>
        {file && !fileError && <p className="text-xs text-muted-foreground">{file.name} · {formatBytes(file.size)}</p>}
        <Field label="Title" htmlFor="doc-title" hint="Optional. Defaults to the file name."><Input id="doc-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Category" htmlFor="doc-cat">
          <Select id="doc-cat" value={category} onChange={(e) => setCategory(e.target.value)}>{DOC_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select>
        </Field>
        {serverError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">{serverError}</p>}
      </form>
    </Dialog>
  )
}

function ChunksDrawer({ doc, onClose }: { doc: DocumentRow | null; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useDocumentChunks(doc?.id)
  return (
    <Drawer open={!!doc} onOpenChange={(o) => !o && onClose()} title={doc?.title ?? 'Chunks'} subtitle={doc ? `${doc.filename} · ${data ? `${data.length} chunk(s)` : 'loading chunks'}` : undefined}>
      {isLoading ? <DetailSkeleton /> : error ? <ErrorState error={error} onRetry={() => void refetch()} /> : !data?.length ? (
        <EmptyState title="No chunks" description={doc?.status === 'indexed' ? 'This document produced no chunks.' : 'Chunks appear once the background worker has indexed the document.'} />
      ) : (
        <ol className="space-y-3">
          {data.map((c) => (
            <li key={c.chunk_index} className="rounded-md border p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge>#{c.chunk_index}</Badge>{c.page != null && <span>page {c.page}</span>}{c.embedding_model && <span className="font-mono">{c.embedding_model}</span>}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm">{c.content}</p>
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  )
}

export function DocumentsPage() {
  const ls = useListState({ status: '' as string, category: '' as string }, { pageSize: 10 })
  const { data, isLoading, error, refetch } = useDocuments(ls.params)
  const reprocess = useReprocessDocument()
  const del = useDeleteDocument()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [view, setView] = useState<DocumentRow | null>(null)
  const [toDelete, setToDelete] = useState<DocumentRow | null>(null)
  const polling = !!data?.items.some((d) => d.status === 'uploaded' || d.status === 'processing')

  const columns: Column<DocumentRow>[] = [
    { key: 'title', header: 'Title', cell: (d) => <div><div className="font-medium">{d.title}</div><div className="text-xs text-muted-foreground">{d.filename}</div></div> },
    { key: 'type', header: 'Type', cell: (d) => <span className="uppercase">{d.file_type}</span> },
    { key: 'category', header: 'Category', cell: (d) => titleCase(d.category) },
    { key: 'size', header: 'Size', align: 'right', cell: (d) => formatBytes(d.size_bytes) },
    { key: 'status', header: 'Status', cell: (d) => <DocStatusBadge doc={d} /> },
    { key: 'chunks', header: 'Chunks', align: 'right', cell: (d) => (d.metadata?.chunks != null ? d.metadata.chunks : '—') },
    { key: 'created', header: 'Uploaded', cell: (d) => fmtDateTime(d.created_at) },
    {
      key: 'actions', header: 'Actions', cell: (d) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label={`View chunks of ${d.title}`} title="View chunks" onClick={() => setView(d)}><Eye className="h-4 w-4" /></Button>
          <Can permission="document:write">
            <Button variant="ghost" size="icon" aria-label={`Reprocess ${d.title}`} title="Reprocess" disabled={reprocess.isPending || d.status === 'processing'} onClick={() => reprocess.mutate(d.id)}><RefreshCw className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" aria-label={`Delete ${d.title}`} title="Delete" onClick={() => setToDelete(d)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </Can>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader title="Documents" description="Policies, procedures and contracts that power the Knowledge Center and the RAG chatbot."
        actions={<Can permission="document:write"><Button onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4" />Upload document</Button></Can>} />
      <div role="note" className="mb-4 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Uploaded files are parsed, chunked and embedded by the <strong>background worker</strong>, not during the upload request. Status moves uploaded → processing → indexed (or failed).{polling && ' This list refreshes every 3 seconds while documents are being processed.'}</span>
      </div>
      <ListCard filters={<>
        <SearchInput value={ls.q} onChange={ls.setQ} placeholder="Search title…" />
        <Select aria-label="Filter by status" className="w-auto" value={ls.filters.status} onChange={(e) => ls.setFilter('status', e.target.value)}>
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </Select>
        <Select aria-label="Filter by category" className="w-auto" value={ls.filters.category} onChange={(e) => ls.setFilter('category', e.target.value)}>
          <option value="">All categories</option>{DOC_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
        </Select>
      </>}>
        <DataTable columns={columns} rows={data?.items} rowKey={(d) => d.id} loading={isLoading} error={error} onRetry={() => void refetch()}
          emptyTitle="No documents" emptyDescription="Upload a policy, procedure or contract to get started, or adjust the filters." />
        {data && <Pagination page={ls.page} pageSize={ls.pageSize} total={data.total} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} />}
      </ListCard>
      <UploadDocumentDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <ChunksDrawer doc={view} onClose={() => setView(null)} />
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} destructive title="Delete document?" confirmLabel="Delete" loading={del.isPending}
        description={<>“{toDelete?.title}” and all of its indexed chunks will be permanently removed.</>}
        onConfirm={() => toDelete && del.mutate(toDelete.id, { onSuccess: () => setToDelete(null) })} />
    </>
  )
}
