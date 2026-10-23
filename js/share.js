// Saving files: the iOS share sheet ("Save to Files") when available, otherwise normal downloads.

/**
 * files: [{ name, text, type }] or [{ name, blob, type }] for images. Build these BEFORE calling (no waiting), because iOS only
 * opens the share sheet straight after a tap.
 * Returns 'shared', 'downloaded' or 'cancelled'.
 */
export async function shareOrDownload(files, title) {
  const make = (plain) => files.map((f) => new File([f.blob || f.text], f.name, { type: plain && !f.blob ? 'text/plain' : f.type }));
  const canShare = (list) => navigator.canShare && navigator.canShare({ files: list });
  let list = make(false);
  if (!canShare(list)) list = make(true); // some browsers only share "plain text" files
  if (canShare(list)) {
    try {
      await navigator.share({ files: list, title });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      // Any other share problem: fall back to downloading.
    }
  }
  for (const f of make(false)) {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return 'downloaded';
}

/** "2026-10-23_2230" for file names. */
export function fileStamp(d = new Date()) {
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
