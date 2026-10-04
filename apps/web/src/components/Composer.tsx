import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, rememberToken } from '../api';
import { useApp } from '../context';
import { prepareScreenshot, preferredRecordingType } from '../media';
import { navigate } from '../router';
import { SAMPLES } from '../samples';

interface Shot {
  file: File;
  url: string;
}

export function Composer({
  initialText = '',
  initialUrl = '',
}: {
  initialText?: string;
  initialUrl?: string;
}) {
  const { t, lang, meta } = useApp();
  const [text, setText] = useState(initialText);
  const [link, setLink] = useState(initialUrl);
  const [showLink, setShowLink] = useState(Boolean(initialUrl));
  const [shots, setShots] = useState<Shot[]>([]);
  const [audio, setAudio] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  const maxImages = meta?.limits.maxImages ?? 5;
  const maxMb = meta?.limits.maxUploadMb ?? 8;

  useEffect(() => () => shots.forEach((s) => URL.revokeObjectURL(s.url)), [shots]);

  async function addShots(files: FileList | null) {
    if (!files) return;
    setError(null);
    const next: Shot[] = [];
    for (const f of Array.from(files)) {
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) {
        setError(t('errType'));
        continue;
      }
      const prepared = await prepareScreenshot(f, maxMb * 1024 * 1024);
      if (prepared.size > maxMb * 1024 * 1024) {
        setError(t('errTooLarge', { mb: maxMb }));
        continue;
      }
      next.push({ file: prepared, url: URL.createObjectURL(prepared) });
    }
    setShots((prev) => [...prev, ...next].slice(0, maxImages));
    if (fileInput.current) fileInput.current.value = '';
  }

  async function toggleRecording() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = preferredRecordingType();
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunks, { type: rec.mimeType });
        const ext = rec.mimeType.includes('ogg')
          ? 'ogg'
          : rec.mimeType.includes('mp4')
            ? 'm4a'
            : 'webm';
        setAudio(new File([blob], `voice-note.${ext}`, { type: rec.mimeType.split(';')[0] }));
        setRecording(false);
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError(t('errType'));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() && !link.trim() && shots.length === 0 && !audio) {
      setError(t('needInput'));
      return;
    }
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('locale', lang);
    if (text.trim()) form.append('text', text);
    if (link.trim()) form.append('url', link.trim());
    shots.forEach((s) => form.append('files', s.file, s.file.name));
    if (audio) form.append('files', audio, audio.name);
    try {
      const created = await api.create(form);
      if (created.ownerToken) rememberToken(created.id, created.ownerToken);
      navigate(`/r/${created.id}`);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'error';
      setError(
        code === 'rate_limited'
          ? t('errRateLimited')
          : code === 'too_large'
            ? t('errTooLarge', { mb: maxMb })
            : code === 'unsupported_type'
              ? t('errType')
              : code === 'network'
                ? t('errNetwork')
                : t('errFailed'),
      );
      setBusy(false);
    }
  }

  return (
    <form className="composer" onSubmit={submit} aria-describedby="composer-help">
      <label className="composer__label" htmlFor="message">
        {t('composerLabel')}
      </label>
      <div className="bubble">
        <textarea
          id="message"
          className="composer__text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('composerPlaceholder')}
          rows={6}
          maxLength={20_000}
          lang={lang}
        />
        {shots.length > 0 && (
          <ul className="shots" aria-label={t('addScreens')}>
            {shots.map((s, i) => (
              <li key={s.url} className="shots__item">
                <img src={s.url} alt="" />
                <button
                  type="button"
                  className="shots__remove"
                  onClick={() => setShots((p) => p.filter((_, j) => j !== i))}
                  aria-label={`${t('remove')} ${i + 1}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {audio && (
          <div className="attachment">
            <span>🎙 {audio.name}</span>
            <button type="button" className="linkish" onClick={() => setAudio(null)}>
              {t('remove')}
            </button>
          </div>
        )}
        {showLink && (
          <input
            className="composer__link"
            type="url"
            inputMode="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder={t('linkPlaceholder')}
            aria-label={t('linkPlaceholder')}
          />
        )}
      </div>

      <div className="composer__tools">
        <button
          type="button"
          className="tool"
          onClick={() => fileInput.current?.click()}
          disabled={shots.length >= maxImages}
        >
          <span aria-hidden="true">🖼</span> {t('addScreens')}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => void addShots(e.target.files)}
        />
        {meta?.audioSupported && (
          <>
            <button
              type="button"
              className={`tool ${recording ? 'tool--live' : ''}`}
              onClick={() => void toggleRecording()}
              aria-pressed={recording}
            >
              <span aria-hidden="true">🎙</span> {recording ? t('stopRecording') : t('addVoice')}
            </button>
            {!recording && (
              <button
                type="button"
                className="tool tool--quiet"
                onClick={() => audioInput.current?.click()}
              >
                {t('uploadAudio')}
              </button>
            )}
            <input
              ref={audioInput}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => setAudio(e.target.files?.[0] ?? null)}
            />
          </>
        )}
        {!showLink && (
          <button type="button" className="tool" onClick={() => setShowLink(true)}>
            <span aria-hidden="true">🔗</span> {t('addLink')}
          </button>
        )}
      </div>

      {error && (
        <p className="composer__error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="investigate" disabled={busy || recording}>
        {busy ? t('starting') : t('investigate')}
      </button>

      <div id="composer-help" className="composer__help">
        <p>
          {t('limits', { n: maxImages, mb: maxMb })}{' '}
          {t('privacy', { days: meta?.reportTtlDays ?? 7 })}
        </p>
        {meta && !meta.readerAvailable && <p>{t('noReader')}</p>}
        {meta?.readerAvailable && <p>{t('processorNotice')}</p>}
      </div>

      <div className="samples">
        <span className="samples__title">{t('samplesTitle')}</span>
        <div className="samples__list">
          <button type="button" className="chip" onClick={() => setText(SAMPLES.adviser)}>
            {t('sampleAdviser')}
          </button>
          <button type="button" className="chip" onClick={() => setText(SAMPLES.crypto)}>
            {t('sampleCrypto')}
          </button>
          <button type="button" className="chip" onClick={() => setText(SAMPLES.genuine)}>
            {t('sampleGenuine')}
          </button>
        </div>
        <p className="samples__note">{t('sampleNote')}</p>
      </div>
    </form>
  );
}
