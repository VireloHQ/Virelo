import { Trans } from '../i18n/Trans';
import { t, useLocale } from '@edition/i18n';
import { useEffect, useId, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button, Input, Modal, Popover } from '@heroui/react';
import { Check, ListPlus, MagnifyingGlass, X } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMediaServices } from '../media-services';
import { playlistName } from '@edition/utils/playlist-values';
import './ConfirmationDialog.css';
import './Playlists.css';

export type PlaylistPickerOpen = { anchor: HTMLElement; keyboard: boolean };
const mobileQuery = () => window.matchMedia('(max-width: 640px), (max-width: 900px) and (pointer: coarse)');
const subscribeMobile = (notify: () => void) => {
  const query = mobileQuery();
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
// Focusing before the floating panel repositions must not scroll past its trigger and dismiss it.
const focusName = (input: HTMLInputElement | null) => input?.focus({ preventScroll: true });
const focusInline = (element: HTMLElement | null) => {
  if (element && !element.contains(document.activeElement)) element.focus({preventScroll:true});
};

export function SavePlaylist({ mediaIds, initialOpen, onClose }: { mediaIds: number[]; initialOpen?: PlaylistPickerOpen; onClose?: () => void }) {
  useLocale();
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const [open, setOpen] = useState(Boolean(initialOpen));
  const [animate, setAnimate] = useState(initialOpen ? !initialOpen.keyboard : false);
  const [notice, setNotice] = useState('');
  const dialogId = useId();
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  const portal = document.fullscreenElement ?? document.body;
  const anchorRef = initialOpen ? { current: initialOpen.anchor } : trigger;
  const close = () => {
    setOpen(false);
    onClose?.();
  };
  const toggle = () => {
    if (pending.current) return;
    if (open) { close(); return; }
    // Opening after the trigger's focus scroll prevents a queued scroll from dismissing the new panel.
    requestAnimationFrame(() => {
      if (!trigger.current?.isConnected) return;
      setNotice('');
      setOpen(true);
    });
  };
  return <div className="save-playlist" onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()}>
    {!initialOpen && <Button ref={trigger} variant="secondary" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined}
      onPressStart={event=>setAnimate(event.pointerType !== 'keyboard')} onPress={toggle}>
      <ListPlus aria-hidden="true"/>{t("Add to playlist")}
    </Button>}
    {open && <PlaylistPicker id={dialogId} mediaIds={mediaIds} overlay={{anchorRef, portal, animate, close}} pending={pending}
      onSaved={name => { setNotice(name); close(); }}/>}
    {notice && createPortal(<span className="playlist-save-notice" role="status">{t('Saved to {name}.',{name:notice})}</span>, portal)}
  </div>;
}

export function PlaylistPicker({ id, mediaIds: selectedMediaIds, overlay, onSaved, pending }: {
  id: string; mediaIds: number[]; overlay?: { anchorRef: RefObject<Element|null>; portal: Element; animate: boolean; close: () => void };
  onSaved: (name: string) => void; pending: RefObject<boolean>;
}) {
  const { api } = useMediaServices();
  const client = useQueryClient();
  const [mediaIds] = useState(selectedMediaIds);
  const mobile = useSyncExternalStore(subscribeMobile, () => mobileQuery().matches);
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists, refetchOnMount: 'always' });
  const [creating, setCreating] = useState<boolean|null>(null);
  const [modeMotion, setModeMotion] = useState(false);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<number>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const [viewportLayer, setViewportLayer] = useState<HTMLDivElement|null>(null);
  const newPlaylist = useRef<HTMLButtonElement>(null);
  const rows = playlists.data ?? [];
  const create = creating ?? (playlists.isSuccess && rows.length === 0);
  const term = search.trim().toLocaleLowerCase();
  const visible = term ? rows.filter(item => item.name.toLocaleLowerCase().includes(term)) : rows;

  async function save() {
    if (pending.current || !mediaIds.length || (create ? !name.trim() : target === undefined)) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      const current = rows.find(item => item.id === target);
      if (!create && !current) throw new Error('Reload the playlist list and try again.');
      const saved = current && !create ? await api.updatePlaylist(current.id, { revision: current.revision, mediaIds, append: true })
        : await api.createPlaylist({ name: playlistName(name), mediaIds });
      await Promise.all([client.invalidateQueries({ queryKey: ['playlists'] }), client.invalidateQueries({ queryKey: ['playlist', saved.id] })]);
      onSaved(saved.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not complete this action. Please try again.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const dismiss = () => { if (!pending.current) overlay?.close(); };
  const openChange = (value: boolean) => { if (!value) dismiss(); };
  const anchorRef = overlay?.anchorRef, close = overlay?.close;
  useEffect(() => {
    if (mobile || !anchorRef || !close) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !panel.current?.contains(target) && !anchorRef.current?.contains(target) && !pending.current) close();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [mobile, anchorRef, pending, close]);
  const title = t("Save to playlist");
  const fields = <>
    {!create && rows.length > 8 && <label className="playlist-picker-search">
      <MagnifyingGlass aria-hidden="true"/><Input inputMode="search" aria-label={t("Search playlists")} placeholder={t("Search playlists")} value={search}
        onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing)event.preventDefault();}}/>
    </label>}
    <div className="playlist-picker-scroll">
      {create ? <label className="playlist-field"><span>{t("Playlist name")}</span><Input ref={focusName} aria-label={t("Playlist name")} maxLength={100} disabled={saving} value={name} onChange={event=>setName(event.target.value)}/></label>
        : visible.length ? <div className="playlist-picker-options" role="radiogroup" aria-label={t("Playlist")}>
          {visible.map(item => <label className="playlist-picker-option" key={item.id} title={item.name}>
            <input type="radio" name={id} checked={target === item.id} disabled={saving} onChange={()=>{setTarget(item.id); setError('');}}/>
            <span className="playlist-picker-check" aria-hidden="true"><Check weight="bold"/></span>
            <span className="playlist-picker-name">{item.name}</span>
            <small aria-hidden="true">{item.itemCount}</small>
          </label>)}
        </div> : playlists.isPending ? <p role="status">{t("Loading playlists…")}</p> : term && <p>{t("No matching playlists")}</p>}
    </div>
  </>;
  const content = <form className="playlist-picker-form" onSubmit={event=>{event.preventDefault(); void save();}} aria-busy={saving}>
    {overlay && <header className="playlist-picker-heading">
      <div><h2>{title}</h2><p>{t('{count} videos',{count:mediaIds.length})}</p></div>
      <Button type="button" variant="ghost" isIconOnly aria-label={t("Cancel")} isDisabled={saving} onPress={dismiss}><X aria-hidden="true"/></Button>
    </header>}
    {overlay ? fields : <div className="playlist-picker-fields" key={create?'create':'choose'} data-animate={modeMotion} data-create={create}>{fields}</div>}
    {!create && playlists.isError && <p className="playlist-picker-feedback error-copy" role="alert"><Trans message="Could not load existing playlists. {value0}"
      values={{value0:<Button type="button" variant="ghost" size="sm" onPress={()=>void playlists.refetch()}>{t("Try again")}</Button>}}/></p>}
    {error && <p className="playlist-picker-feedback error-copy" role="alert">{t(error)}{!create && <Button type="button" variant="ghost" size="sm" onPress={()=>void playlists.refetch()}>{t("Refresh playlists")}</Button>}</p>}
    <footer className="playlist-picker-footer">
      {create ? (rows.length > 0 || playlists.isError) && <Button type="button" variant="ghost" isDisabled={saving}
        onPress={event=>{setModeMotion(event.pointerType!=='keyboard');setCreating(false);setError('');requestAnimationFrame(()=>newPlaylist.current?.focus({preventScroll:true}));}}>{t("Back")}</Button>
        : <Button ref={newPlaylist} type="button" variant="ghost" isDisabled={saving} onPress={event=>{setModeMotion(event.pointerType!=='keyboard');setCreating(true);setError('');}}><ListPlus aria-hidden="true"/>{t("New playlist")}</Button>}
      <Button type="submit" isPending={saving} isDisabled={saving || !mediaIds.length || (create ? !name.trim() : !rows.some(item=>item.id===target))}>{t("Save")}</Button>
    </footer>
  </form>;

  if (!overlay) return <section ref={focusInline} id={id} className="playlist-picker-inline" aria-label={title} tabIndex={-1}>{content}</section>;
  const {portal, animate} = overlay;
  return mobile
    ? <Modal.Backdrop isOpen onOpenChange={openChange} isDismissable={!saving} isKeyboardDismissDisabled={saving} className="virelo-confirm-backdrop" data-animate={animate} UNSTABLE_portalContainer={portal}>
        <Modal.Container className="virelo-confirm-container playlist-picker-container" data-animate={animate} placement="center" scroll="inside">
          <Modal.Dialog id={id} className="playlist-picker" aria-label={title}>{content}</Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    : createPortal(<div ref={setViewportLayer} className="playlist-picker-viewport">
        {viewportLayer && <Popover.Content ref={panel} isOpen onOpenChange={openChange} isNonModal isKeyboardDismissDisabled={saving}
          triggerRef={overlay.anchorRef} placement="bottom start" offset={8} containerPadding={12} maxHeight={414} boundaryElement={viewportLayer}
          shouldCloseOnInteractOutside={element=>!pending.current && !overlay.anchorRef.current?.contains(element)} className="playlist-picker-popover" data-animate={animate} UNSTABLE_portalContainer={viewportLayer}>
          <Popover.Dialog id={id} className="playlist-picker" aria-label={title}>{content}</Popover.Dialog>
        </Popover.Content>}
      </div>, portal);
}
