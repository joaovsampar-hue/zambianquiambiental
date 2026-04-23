import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export async function rasterizePdfToJpegs(file: File, scale = 1.5, quality = 0.85): Promise<Blob[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const blobs: Blob[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality),
    );
    blobs.push(blob);
    page.cleanup();
  }
  return blobs;
}

export async function uploadPdfPagesAsJpegs(
  file: File,
  userId: string,
  prefix: string,
  supabase: any,
): Promise<string[]> {
  const pageBlobs = await rasterizePdfToJpegs(file);
  const imagePaths: string[] = [];
  for (let i = 0; i < pageBlobs.length; i++) {
    const path = `${prefix}/page-${String(i + 1).padStart(3, '0')}.jpg`;
    const { error } = await supabase.storage
      .from('matriculas')
      .upload(path, pageBlobs[i], { contentType: 'image/jpeg' });
    if (error) throw error;
    imagePaths.push(path);
  }
  return imagePaths;
}