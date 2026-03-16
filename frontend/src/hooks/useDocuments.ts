import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import toast from 'react-hot-toast';

export function useDocuments(page = 1, limit = 20, status?: string, poll = false) {
  return useQuery({
    queryKey: ['documents', page, limit, status],
    queryFn: () => apiClient.get<any>('/documents', { page, limit, status }),
    staleTime: poll ? 0 : 30_000,
    refetchInterval: poll ? 3000 : false,
    refetchOnWindowFocus: poll,
  });
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: ['document', id],
    queryFn: () => apiClient.get<any>(`/documents/${id}`),
    enabled: !!id,
  });
}

export function useDocumentStatus(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['document-status', id],
    queryFn: () => apiClient.get<any>(`/documents/${id}/status`),
    enabled: enabled && !!id,
    refetchInterval: (data: any) =>
      data?.status === 'completed' || data?.status === 'failed' ? false : 3000,
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/documents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Document deleted');
    },
    onError: () => toast.error('Failed to delete document'),
  });
}

export function useUpload() {
  const qc = useQueryClient();
  const [progress, setProgress] = useState(0);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      let documentId: string | null = null;
      try {
        // Step 1: Get presigned URL
        const presign = await apiClient.post<any>('/documents/upload-url', {
          filename: file.name,
          fileSize: file.size,
          mimeType: file.type,
        });
        documentId = presign.documentId;

        // Step 2: Upload directly to S3
        await uploadToS3(presign.uploadUrl, file, setProgress);

        // Step 3: Trigger processing
        return await apiClient.post<any>('/documents', { documentId });
      } catch (error) {
        console.error('[Upload] failed', { filename: file.name, documentId, error });
        if (documentId) {
          // Avoid leaving orphan "pending" rows behind when upload/trigger fails.
          await apiClient.delete(`/documents/${documentId}`).catch((deleteError) => {
            console.error('[Upload] cleanup failed', { documentId, deleteError });
          });
        }
        throw error;
      } finally {
        setProgress(0);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Document uploaded and queued for processing');
    },
    onError: (err: any) => {
      console.error('[Upload] error', err);
      toast.error(err?.response?.data?.message || 'Upload failed');
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  return { ...uploadMutation, progress };
}

async function uploadToS3(url: string, file: File, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => xhr.status === 200
      ? resolve()
      : reject(new Error(`S3 upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload blocked or failed. Check S3 CORS and network connectivity.'));
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
}

export function useRetryDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/documents/${id}/retry`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Document queued for processing');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to queue document');
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

// Needed for useUpload hook
import { useState } from 'react';
