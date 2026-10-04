import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import { api, ApiError, rememberToken } from '../api';
import { useApp } from '../context';
import { prepareScreenshot, preferredRecordingType } from '../media';
import { navigate } from '../router';
import { SAMPLES } from '../samples';
import {
  IconArrowRight,
  IconAudioFile,
  IconClose,
  IconImage,
  IconLink,
  IconMic,
  IconStop,
} from './Icons';

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
  const [dragging, setDragging] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  const maxImages = meta?.limits.maxImages ?? 5;
  const maxMb = meta?.limits.maxUploadMb ?? 8;

  useEffect(() => () => shots.forEach((s) => URL.revokeObjectURL(s.url)), [shots]);

  async function addShots(files: FileList | File[] | null) {
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

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void addShots(e.dataTransfer.files);
  }

  // Screenshots pasted straight from the clipboard are added like uploads.
  function onPaste(e: ClipboardEvent) {
    const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    e.preventDefault();
    void addShots(images);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() && !link.trim() && shots.length === 0 && !audio) {
      setError(t('needInput'));
      return;
    }
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.append('locale', lang);
    if (text.trim()) body.append('text', text);
    if (link.trim()) body.append('url', link.trim());
    shots.forEach((s) => body.append('files', s.file, s.file.name));
    if (audio) body.append('files', audio, audio.name);
    try {
      const created = await api.create(body);
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
    <form ref={form} className="composer" onSubmit={submit} aria-describedby="composer-help">
      <label className="composer__label" htmlFor="message">
        {t('composerLabel')}
      </label>
      <div
        className={`bubble ${dragging ? 'bubble--drop' : ''}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <textarea
          id="message"
          className="composer__text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              form.current?.requestSubmit();
            }
          }}
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
                  <IconClose />
                </button>
              </li>
            ))}
          </ul>
        )}
        {audio && (
          <div className="attachment">
            <span className="attachment__name">
              <IconMic /> {audio.name}
            </span>
            <button type="button" className="linkish" onClick={() => setAudio(null)}>
              {t('remove')}
            </button>
          </div>
        )}
        {showLink && (
          <div className="composer__linkrow">
            <IconLink />
            <input
              className="composer__link"
              type="url"
              inputMode="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder={t('linkPlaceholder')}
              aria-label={t('linkPlaceholder')}
            />
          </div>
        )}
        <div className="composer__tools">
          <button
            type="button"
            className="tool"
            onClick={() => fileInput.current?.click()}
            disabled={shots.length >= maxImages}
          >
            <IconImage /> <span>{t('addScreens')}</span>
            {shots.length > 0 && (
              <span className="tool__count">
                {shots.length}/{maxImages}
              </span>
            )}
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
                {recording ? <IconStop /> : <IconMic />}{' '}
                <span>{recording ? t('stopRecording') : t('addVoice')}</span>
              </button>
              {!recording && (
                <button
                  type="button"
                  className="tool tool--quiet"
                  onClick={() => audioInput.current?.click()}
                >
                  <IconAudioFile /> <span>{t('uploadAudio')}</span>
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
              <IconLink /> <span>{t('addLink')}</span>
            </button>
          )}
          {text.length > 0 && (
            <span className="composer__count" aria-hidden="true">
              {t('chars', { n: text.length.toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN') })}
            </span>
          )}
        </div>
        {dragging && (
          <div className="bubble__drop" aria-hidden="true">
            <IconImage /> {t('dropHere')}
          </div>
        )}
      </div>

      {error && (
        <p className="composer__error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="investigate" disabled={busy || recording} aria-busy={busy}>
        {busy ? (
          <>
            <span className="spinner" aria-hidden="true" /> {t('starting')}
          </>
        ) : (
          <>
            <span>{t('investigate')}</span>
            <IconArrowRight size={22} />
            <kbd className="investigate__kbd" aria-hidden="true">
              {t('submitHint')}
            </kbd>
          </>
        )}
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
          {(
            [
              ['adviser', 'sampleAdviser'],
              ['crypto', 'sampleCrypto'],
              ['genuine', 'sampleGenuine'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`chip ${text === SAMPLES[key] ? 'chip--on' : ''}`}
              aria-pressed={text === SAMPLES[key]}
              onClick={() => setText(SAMPLES[key])}
            >
              <span className="chip__title">{t(label)}</span>
              <span className="chip__preview" aria-hidden="true">
                {SAMPLES[key].split('\n')[0]}
              </span>
            </button>
          ))}
        </div>
        <p className="samples__note">{t('sampleNote')}</p>
      </div>
    </form>
  );
}
